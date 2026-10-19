import base64
import json
from pathlib import Path
import secrets
import shlex
import subprocess
import tempfile

REPO = 'lextoc/workboard'
ROOT = Path(__file__).resolve().parents[1]
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@alexanderclaes.be']

def run(args, data=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout

def api(endpoint, method='GET', payload=None):
    args = ['gh', 'api', endpoint, '--method', method]
    if payload is not None:
        args += ['--input', '-']
    result = run(args, None if payload is None else json.dumps(payload).encode())
    return json.loads(result) if result else None

remote_install = (ROOT / 'deploy/install-deploy.py').read_text()


def configure():
    with tempfile.TemporaryDirectory(prefix='workboard-deploy-key-') as temporary:
        temporary = Path(temporary)
        private_key = temporary / 'id_ed25519'
        run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'github-actions-workboard-production', '-f', str(private_key)])
        credentials = {'email': f'workboard-ci-{secrets.token_hex(6)}@example.com', 'password': secrets.token_urlsafe(36)}
        host_key = run(SSH + ['cat /etc/ssh/ssh_host_ed25519_key.pub']).decode().split()
        known_hosts = 'alexanderclaes.be ' + ' '.join(host_key[:2]) + '\n'
        (temporary / 'known_hosts').write_text(known_hosts)
        api(f'repos/{REPO}/environments/production', 'PUT', {
            'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}
        })
        rules = api(f'repos/{REPO}/environments/production/deployment-branch-policies')
        if not any(rule['name'] == 'main' and rule['type'] == 'branch' for rule in rules['branch_policies']):
            api(f'repos/{REPO}/environments/production/deployment-branch-policies', 'POST', {'name': 'main', 'type': 'branch'})
        for name, value in {'DEPLOY_HOST': 'alexanderclaes.be', 'DEPLOY_USER': 'workboard-deploy'}.items():
            run(['gh', 'variable', 'set', name, '--env', 'production', '--repo', REPO, '--body', value])
        for name, value in {
            'DEPLOY_SSH_KEY': private_key.read_bytes(),
            'DEPLOY_KNOWN_HOSTS': known_hosts.encode(),
            'SMOKE_EMAIL': credentials['email'].encode(),
            'SMOKE_PASSWORD': credentials['password'].encode(),
        }.items():
            run(['gh', 'secret', 'set', name, '--env', 'production', '--repo', REPO], value)
        print('GitHub production environment, branch policy, variables and encrypted secrets configured', flush=True)
        payload = {
            'public_key': private_key.with_suffix('.pub').read_text(),
            'credentials': credentials,
            'files': {name: base64.b64encode((ROOT / 'deploy' / name).read_bytes()).decode() for name in ['workboard-deploy', 'workboard-deploy-ssh', 'workboard-deploy.sudoers', 'smoke-test.py']},
        }
        output = run(SSH + ['python3 -c ' + shlex.quote(remote_install)], json.dumps(payload).encode())
        print(output.decode().strip(), flush=True)
        connection = ['ssh', '-T', '-i', str(private_key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={temporary / "known_hosts"}', 'workboard-deploy@alexanderclaes.be']
        assert b'connection ready' in run(connection + ['check'])
        rejected = subprocess.run(connection + ['id'], capture_output=True)
        assert rejected.returncode != 0 and b'Only check and deploy' in rejected.stderr
        rejected = subprocess.run(connection + ['deploy ' + 'a' * 40 + '-0-1 ' + '0' * 64], input=b'invalid archive', capture_output=True)
        assert rejected.returncode != 0 and b'checksum does not match' in rejected.stderr
        print('Deployment key verified: connection works, shell commands rejected, checksum failure rejected', flush=True)
        api(f'repos/{REPO}/branches/main/protection', 'PUT', {
            'required_status_checks': {'strict': True, 'contexts': ['Build, test and package']},
            'enforce_admins': True,
            'required_pull_request_reviews': {'required_approving_review_count': 0, 'dismiss_stale_reviews': True},
            'restrictions': None,
            'required_conversation_resolution': True,
            'allow_force_pushes': False,
            'allow_deletions': False,
        })
        print('Main protected: pull request, passing delivery check, up-to-date branch, resolved conversations; applies to admins', flush=True)
        status = run(SSH + ['systemctl is-active workboard.service']).decode().strip()
        print('Existing production service: ' + status, flush=True)


if __name__ == "__main__":
    configure()
