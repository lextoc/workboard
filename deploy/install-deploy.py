import base64
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
payload = json.load(sys.stdin)
try:
    pwd.getpwnam('workboard-deploy')
except KeyError:
    subprocess.run(['/usr/sbin/useradd', '--system', '--create-home', '--home-dir', '/var/lib/workboard-deploy', '--shell', '/bin/sh', '--password', '*', 'workboard-deploy'], check=True)
home = Path('/var/lib/workboard-deploy')
home.mkdir(exist_ok=True)
os.chown(home, 0, 0)
home.chmod(0o755)
ssh = home / '.ssh'
ssh.mkdir(exist_ok=True)
os.chown(ssh, 0, 0)
ssh.chmod(0o755)
key = ssh / 'authorized_keys'
key.write_text('restrict,command="/usr/local/bin/workboard-deploy-ssh" ' + payload['public_key'].strip() + '\n')
os.chown(key, 0, 0)
key.chmod(0o644)
for name, target, mode in [
    ('workboard-deploy', '/usr/local/sbin/workboard-deploy', 0o755),
    ('workboard-deploy-ssh', '/usr/local/bin/workboard-deploy-ssh', 0o755),
    ('workboard-deploy.sudoers', '/etc/sudoers.d/workboard-deploy', 0o440),
]:
    path = Path(target)
    path.write_bytes(base64.b64decode(payload['files'][name]))
    os.chown(path, 0, 0)
    path.chmod(mode)
subprocess.run(['/usr/sbin/visudo', '-cf', '/etc/sudoers.d/workboard-deploy'], check=True)
credentials = payload['credentials']
config = Path('/etc/workboard/deploy-smoke.json')
config.touch(mode=0o600, exist_ok=True)
config.chmod(0o600)
config.write_text(json.dumps(credentials) + '\n')
hash_result = subprocess.run(['/usr/bin/openssl', 'passwd', '-6', '-stdin'], input=(credentials['password'] + '\n').encode(), capture_output=True, check=True)
htpasswd = Path('/etc/workboard/htpasswd')
lines = [line for line in htpasswd.read_text().splitlines() if not line.startswith(credentials['username'] + ':')]
lines.append(credentials['username'] + ':' + hash_result.stdout.decode().strip())
htpasswd.write_text('\n'.join(lines) + '\n')
subprocess.run(['/usr/sbin/nginx', '-t'], check=True)
print('Restricted deployment entry point installed')
