const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('playwright/test');

const assets = path.resolve(__dirname, '../../main/resources/META-INF/resources');
const projectId = '00000000-0000-0000-0000-000000000001';
const otherProjectId = '00000000-0000-0000-0000-000000000002';
const assignedId = '00000000-0000-0000-0000-000000000011';
const unassignedId = '00000000-0000-0000-0000-000000000012';
let server;
let browser;
let origin;

before(async () => {
    server = http.createServer(async (request, response) => {
        const files = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
        const file = files[request.url];
        if (!file) {
            response.writeHead(404).end();
            return;
        }
        response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript'
            : file.endsWith('.css') ? 'text/css' : 'text/html');
        response.end(await fs.readFile(path.join(assets, file)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
});

after(async () => {
    await browser?.close();
    await new Promise(resolve => server ? server.close(resolve) : resolve());
});

async function workspace(t, options = {}) {
    const context = await browser.newContext(options.context);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    t.after(() => context.close());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = {
        projects: [
            { id: projectId, name: 'Workboard' },
            { id: otherProjectId, name: 'Another project' }
        ],
        tickets: [
            { id: assignedId, title: 'Assigned task', status: 'TODO', blocked: false, blockedNote: null, completedAt: null, projectId },
            { id: unassignedId, title: 'Unassigned task', status: 'DOING', blocked: false, blockedNote: null, completedAt: null, projectId: null }
        ],
        writes: [],
        ...options.state
    };
    const ticketResponse = ticket => ({
        ...ticket,
        projectName: state.projects.find(project => project.id === ticket.projectId)?.name ?? null
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const [, , resource, id] = new URL(request.url()).pathname.split('/');
        const method = request.method();
        const data = request.postDataJSON();
        if (method !== 'GET') state.writes.push({ resource, id, method, data });
        const reply = (body, status = 200) => route.fulfill({ status, json: body });
        if (resource === 'projects') {
            if (options.projectsUnavailable) return reply({ message: 'Not found' }, 404);
            if (method === 'GET') return reply(state.projects);
            if (method === 'POST') {
                if (!data.name.trim()) return reply({ message: 'Project name must not be blank.' }, 400);
                const project = { id: '00000000-0000-0000-0000-000000000003', name: data.name };
                state.projects.push(project);
                return reply(project, 201);
            }
            const project = state.projects.find(item => item.id === id);
            if (method === 'PUT') {
                project.name = data.name;
                return reply(project);
            }
            if (method === 'DELETE') {
                if (state.tickets.some(ticket => ticket.projectId === id)) return reply({ message: 'Project still has assigned tickets.' }, 409);
                state.projects = state.projects.filter(item => item.id !== id);
                return route.fulfill({ status: 204 });
            }
        }
        if (resource === 'tickets') {
            if (method === 'GET') return reply(id ? ticketResponse(state.tickets.find(ticket => ticket.id === id))
                : state.tickets.map(ticketResponse));
            if (method === 'POST') {
                const ticket = {
                    ...data, id: '00000000-0000-0000-0000-000000000013',
                    blocked: false, blockedNote: null, completedAt: null
                };
                if (options.ignoreAssignment) ticket.projectId = null;
                state.tickets.push(ticket);
                return reply({ ...ticket, project: state.projects.find(project => project.id === ticket.projectId) ?? null }, 201);
            }
            const ticket = state.tickets.find(item => item.id === id);
            if (method === 'PUT') {
                if (options.rejectUpdate) return reply({ message: 'Assignment rejected.' }, 400);
                const previousProject = ticket.projectId;
                Object.assign(ticket, data);
                if (options.ignoreAssignment) ticket.projectId = previousProject;
                return reply({ ...ticket, project: state.projects.find(project => project.id === ticket.projectId) ?? null });
            }
            if (method === 'DELETE') {
                state.tickets = state.tickets.filter(item => item.id !== id);
                return route.fulfill({ status: 204 });
            }
        }
        return reply({ message: 'Unexpected request' }, 500);
    });
    await page.goto(origin);
    await expect(page.locator('#feedback')).toHaveText('Tickets refreshed.');
    t.after(() => assert.deepEqual(errors, []));
    return { page, state };
}

async function capture(page, name) {
    const directory = process.env.WORKBOARD_SCREENSHOT_DIR;
    if (!directory) return;
    await fs.mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

test('filters assigned and unassigned tickets and updates visible counts', async t => {
    const { page } = await workspace(t);
    await capture(page, 'desktop');
    await expect(page.locator(`[data-ticket-id="${assignedId}"] .project-badge`)).toHaveText('Workboard');
    await page.locator('#project-filter').selectOption(projectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await expect(page.locator('[data-status="DOING"] .count')).toHaveText('0');
    await expect(page.locator('[data-status="TODO"] .create-project')).toHaveValue(projectId);
    await page.locator('#project-filter').selectOption('unassigned');
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await expect(page.locator(`[data-ticket-id="${unassignedId}"]`)).toBeVisible();
    await page.locator('#project-filter').selectOption(otherProjectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(0);
    await expect(page.locator('.empty:visible')).toHaveCount(3);
});

test('creates a ticket in the selected project and preserves assignment during title edits and moves', async t => {
    const { page, state } = await workspace(t);
    await page.locator('#project-filter').selectOption(projectId);
    await page.locator('#todo-title').fill('New project task');
    await page.locator('[data-status="TODO"] .create-form button[type="submit"]').click();
    const card = page.locator('[data-ticket-id="00000000-0000-0000-0000-000000000013"]');
    await expect(card.locator('.project-badge')).toHaveText('Workboard');
    await card.locator('.ticket-title').click();
    await expect(page.locator('#project-filter')).toBeDisabled();
    await card.locator('textarea').fill('Renamed task');
    await card.locator('textarea').press('Control+Enter');
    await expect(card.locator('.ticket-title')).toHaveText('Renamed task');
    await card.locator('.ticket-menu-trigger').click();
    await card.getByRole('button', { name: /Start ticket/ }).click();
    await expect(page.locator('[data-status="DOING"] .ticket-title', { hasText: 'Renamed task' })).toBeVisible();
    assert.equal(state.writes.length, 3);
    assert.ok(state.writes.every(write => write.data.projectId === projectId));
});

test('assigns and unassigns existing tickets and removes them from an incompatible filter', async t => {
    const { page } = await workspace(t);
    let card = page.locator(`[data-ticket-id="${unassignedId}"]`);
    await card.locator('.ticket-menu-trigger').click();
    await card.locator('.ticket-project-select').selectOption(projectId);
    await expect(card.locator('.project-badge')).toHaveText('Workboard');
    await page.locator('#project-filter').selectOption(projectId);
    await card.locator('.ticket-menu-trigger').click();
    await card.locator('.ticket-project-select').selectOption('');
    await expect(card).toBeHidden();
    await expect(page.locator('#feedback')).toContainText('outside the selected project view');
    await expect(page.locator('#project-filter')).toBeFocused();
});

test('creates, renames and deletes projects and reports conflicts without hiding the dialog', async t => {
    const { page } = await workspace(t);
    await page.locator('#manage-projects').click();
    await page.locator('#project-name').fill('');
    await page.locator('#save-project').click();
    await expect(page.locator('#project-feedback')).toContainText('Project name must not be blank.');
    await page.locator('#project-name').fill('New project');
    await page.locator('#save-project').click();
    await expect(page.locator('#project-feedback')).toContainText('Project created.');
    await page.locator('#managed-project').selectOption(projectId);
    await page.locator('#project-name').fill('Renamed project');
    await page.locator('#save-project').click();
    await expect(page.locator('#project-feedback')).toHaveText('Project renamed.');
    await expect(page.locator(`[data-ticket-id="${assignedId}"] .project-badge`)).toHaveText('Renamed project');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#delete-project').click();
    await expect(page.locator('#project-feedback')).toContainText('Project still has assigned tickets.');
    await page.locator('#managed-project').selectOption('00000000-0000-0000-0000-000000000003');
    await page.locator('#delete-project').click();
    await expect(page.locator('#project-feedback')).toHaveText('Project deleted.');
    await expect(page.locator('#managed-project option', { hasText: 'New project' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#project-dialog')).not.toBeVisible();
});

test('keeps tickets usable when the project API is unavailable', async t => {
    const { page, state } = await workspace(t, { projectsUnavailable: true });
    await expect(page.locator('#project-notice')).toBeVisible();
    await expect(page.locator('.create-project').first()).toBeDisabled();
    await page.locator('#project-filter').selectOption(projectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    const card = page.locator(`[data-ticket-id="${assignedId}"]`);
    await card.locator('.ticket-title').click();
    await card.locator('textarea').fill('Still editable');
    await card.locator('textarea').press('Control+Enter');
    await expect(card.locator('.ticket-title')).toHaveText('Still editable');
    assert.equal(state.writes[0].data.projectId, projectId);
    await page.locator('#manage-projects').click();
    await expect(page.locator('#save-project')).toBeDisabled();
    await expect(page.locator('#close-projects')).toBeEnabled();
});

test('reports ignored assignments rather than claiming success', async t => {
    const { page } = await workspace(t, { ignoreAssignment: true });
    const card = page.locator(`[data-ticket-id="${unassignedId}"]`);
    await card.locator('.ticket-menu-trigger').click();
    await card.locator('.ticket-project-select').selectOption(projectId);
    await expect(card.locator('.ticket-feedback')).toContainText('project assignment was not applied');
    await expect(card.locator('.project-badge')).toHaveText('Unassigned');
    await page.locator('[data-status="TODO"] .create-project').selectOption(projectId);
    await page.locator('#todo-title').fill('Created without expected project');
    await page.locator('[data-status="TODO"] .create-form button[type="submit"]').click();
    await expect(page.locator('#todo-create-error')).toContainText('project assignment was not applied');
    await expect(page.locator('#todo-title')).toHaveValue('');
});

test('shows assignment errors and restores controls for retry', async t => {
    const { page } = await workspace(t, { rejectUpdate: true });
    const card = page.locator(`[data-ticket-id="${assignedId}"]`);
    await card.locator('.ticket-menu-trigger').click();
    await card.locator('.ticket-project-select').selectOption(otherProjectId);
    await expect(card.locator('.ticket-feedback')).toContainText('Assignment rejected.');
    await expect(card.locator('.ticket-project-select')).toBeEnabled();
    await expect(card.locator('.ticket-project-select')).toHaveValue(projectId);
    await expect(card.locator('.project-badge')).toHaveText('Workboard');
});

test('keeps mobile layouts within the viewport in light and dark themes', async t => {
    for (const colorScheme of ['light', 'dark']) {
        const { page } = await workspace(t, { context: { viewport: { width: 390, height: 844 }, colorScheme } });
        await page.locator('#manage-projects').click();
        await expect(page.locator('#project-dialog')).toBeVisible();
        await capture(page, `mobile-dialog-${colorScheme}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await page.keyboard.press('Escape');
        await page.locator('#project-filter').selectOption(projectId);
        await expect(page.locator('.ticket:visible')).toHaveCount(1);
        await capture(page, `mobile-board-${colorScheme}`);
    }
});
