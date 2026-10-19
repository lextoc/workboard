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
        const files = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/picker.js': 'picker.js' };
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
    if (options.storageUnavailable) {
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                get() { throw new DOMException('Storage unavailable', 'SecurityError'); }
            });
        });
    }
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
        authWrites: [],
        requests: [],
        authenticated: true,
        user: { id: 'user-1', email: 'alex@example.com' },
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
        state.requests.push({ resource, id, method, headers: request.headers() });
        if (method !== 'GET' && resource !== 'auth') {
            assert.equal(request.headers()['x-workboard-request'], '1');
            state.writes.push({ resource, id, method, data });
        }
        const reply = (body, status = 200) => route.fulfill({ status, json: body });
        if (resource === 'auth') {
            if (method !== 'GET') {
                assert.equal(request.headers()['x-workboard-request'], '1');
                state.authWrites.push({ id, method, data, headers: request.headers() });
            }
            if (id === 'me') {
                if (state.sessionUnavailable) return reply({ message: 'Session service unavailable.' }, 503);
                return state.authenticated ? reply(state.user) : reply({ message: 'Authentication required.' }, 401);
            }
            if (id === 'register') {
                if (state.registrationFailure) return reply({ message: state.registrationFailure }, 409);
                return reply(state.user, 201);
            }
            if (id === 'login') {
                if (state.loginFailure) return reply({ message: state.loginFailure }, 401);
                state.authenticated = true;
                return reply(state.user);
            }
            if (id === 'logout') {
                if (state.logoutFailure) return reply({ message: 'Logout unavailable.' }, 503);
                state.authenticated = false;
                return route.fulfill({ status: 204 });
            }
        }
        if (!state.authenticated) return route.fulfill({ status: 401 });
        if (resource === 'projects') {
            if (options.projectsUnavailable || state.projectsUnavailable) return reply({ message: 'Not found' }, 404);
            if (method === 'GET') return reply(state.projects);
            if (method === 'POST' || method === 'PUT') {
                if (!data.name.trim()) return reply({ message: 'Project name cannot be blank.' }, 400);
                if (data.name.length > 200) return reply({
                    violations: [{ field: 'request.name', message: 'Project name cannot exceed 200 characters.' }]
                }, 400);
            }
            if (method === 'POST') {
                const project = { id: '00000000-0000-0000-0000-000000000003', name: data.name };
                state.projects.push(project);
                return reply(project, 201);
            }
            const project = state.projects.find(item => item.id === id);
            if (method === 'PUT') {
                if (!project) return reply({ message: 'Project not found.' }, 404);
                project.name = data.name;
                return reply(project);
            }
            if (method === 'DELETE') {
                if (!project) return reply({ message: 'Project not found.' }, 404);
                if (state.projectDeleteFailure || state.tickets.some(ticket => ticket.projectId === id)) {
                    if (state.projectDeleteFailure === 500) return route.fulfill({ status: 500, body: '' });
                    return reply({ message: 'Project has assigned tickets.' }, state.projectDeleteFailure || 409);
                }
                state.projects = state.projects.filter(project => project.id !== id);
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
    if (state.sessionUnavailable) {
        await expect(page.locator('#retry-session')).toBeVisible();
    } else if (state.authenticated) {
        await expect(page.locator('#feedback')).toHaveText('Tickets refreshed.');
    } else {
        await expect(page.locator('#auth-form')).toBeVisible();
    }
    t.after(() => assert.deepEqual(errors, []));
    return { page, state };
}

async function choose(picker, value) {
    await picker.locator('.picker-trigger').click();
    await picker.locator(`.picker-option[data-value="${value}"]`).click();
}

async function capture(page, name) {
    const directory = process.env.WORKBOARD_SCREENSHOT_DIR;
    if (!directory) return;
    await fs.mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: !await page.locator('dialog[open]').count() });
}

test('filters assigned and unassigned tickets and updates visible counts', async t => {
    const { page } = await workspace(t);
    await capture(page, 'desktop');
    await expect(page.locator(`[data-ticket-id="${assignedId}"] .project-badge`)).toHaveText('Workboard');
    await choose(page.locator('#project-filter'), projectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await expect(page.locator('[data-status="DOING"] .count')).toHaveText('0');
    await expect(page.locator('[data-status="TODO"] .create-project')).toHaveJSProperty('value', projectId);
    await choose(page.locator('#project-filter'), 'unassigned');
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await expect(page.locator(`[data-ticket-id="${unassignedId}"]`)).toBeVisible();
    await choose(page.locator('#project-filter'), otherProjectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(0);
    await expect(page.locator('.empty:visible')).toHaveCount(3);
});

test('combines search, project and blocked filters and resets the view', async t => {
    const { page, state } = await workspace(t);
    state.tickets[0].blocked = true;
    state.tickets[0].blockedNote = 'Waiting for design';
    await page.locator('#refresh').click();
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#project-summary')).toHaveText('2 tickets');
    await page.keyboard.press('/');
    await expect(page.locator('#ticket-search')).toBeFocused();
    await page.locator('#ticket-search').fill('DESIGN');
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await expect(page.locator('[data-status="TODO"] .count')).toHaveText('1');
    await expect(page.locator('[data-status="DOING"] .count')).toHaveText('0');
    await page.locator('#blocked-filter').click();
    await expect(page.locator('#blocked-filter')).toHaveAttribute('aria-pressed', 'true');
    await choose(page.locator('#project-filter'), otherProjectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(0);
    await expect(page.locator('.empty strong').first()).toHaveText('No matching tickets');
    await page.locator('#clear-filters').click();
    await expect(page.locator('.ticket:visible')).toHaveCount(2);
    await expect(page.locator('#ticket-search')).toBeFocused();
    await expect(page.locator('#blocked-filter')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#clear-filters')).toBeHidden();
    await expect(page.locator('.create-project').first()).toHaveJSProperty('value', '');
    await page.locator('#ticket-search').fill('workboard');
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await page.locator('#ticket-search').press('Escape');
    await expect(page.locator('.ticket:visible')).toHaveCount(2);
    const card = page.locator(`[data-ticket-id="${assignedId}"]`);
    await card.locator('.ticket-title').click();
    await expect(page.locator('#ticket-search')).toBeDisabled();
    await expect(page.locator('#blocked-filter')).toBeDisabled();
    await card.locator('textarea').press('/');
    await expect(card.locator('textarea')).toBeFocused();
    await card.locator('textarea').press('Escape');
    await expect(page.locator('#ticket-search')).toBeEnabled();
});

test('creates a ticket in the selected project and preserves assignment during title edits and moves', async t => {
    const { page, state } = await workspace(t);
    await choose(page.locator('#project-filter'), projectId);
    await page.locator('#todo-title').fill('New project task');
    await page.locator('[data-status="TODO"] .create-form button[type="submit"]').click();
    const card = page.locator('[data-ticket-id="00000000-0000-0000-0000-000000000013"]');
    await expect(card.locator('.project-badge')).toHaveText('Workboard');
    await card.locator('.ticket-title').click();
    await expect(page.locator('#project-filter').locator('.picker-trigger')).toBeDisabled();
    await card.locator('textarea').fill('Renamed task');
    await card.locator('textarea').press('Control+Enter');
    await expect(card.locator('.ticket-title')).toHaveText('Renamed task');
    await card.getByRole('button', { name: /Start ticket/ }).click();
    await expect(page.locator('[data-status="DOING"] .ticket-title', { hasText: 'Renamed task' })).toBeVisible();
    assert.equal(state.writes.length, 3);
    assert.ok(state.writes.every(write => write.data.projectId === projectId));
});

test('assigns and unassigns existing tickets and removes them from an incompatible filter', async t => {
    const { page } = await workspace(t);
    let card = page.locator(`[data-ticket-id="${unassignedId}"]`);
    await card.locator('.ticket-menu-trigger').click();
    await choose(card.locator('.ticket-project-select'), projectId);
    await expect(card.locator('.project-badge')).toHaveText('Workboard');
    await choose(page.locator('#project-filter'), projectId);
    await card.locator('.ticket-menu-trigger').click();
    await choose(card.locator('.ticket-project-select'), '');
    await expect(card).toBeHidden();
    await expect(page.locator('#feedback')).toContainText('outside the selected project view');
    await expect(page.locator('#project-filter').locator('.picker-trigger')).toBeFocused();
});

test('creates and renames projects and keeps the saved project selected', async t => {
    const { page } = await workspace(t);
    await page.locator('#manage-projects').click();
    await page.locator('#project-name').fill('');
    await page.locator('#save-project').click();
    await expect(page.locator('#project-feedback')).toContainText('Project name cannot be blank.');
    await page.locator('#project-name').fill('New project');
    await page.locator('#save-project').click();
    await expect(page.locator('#project-feedback')).toContainText('Project created.');
    await expect(page.locator('#managed-project')).toHaveJSProperty('value', '00000000-0000-0000-0000-000000000003');
    await expect(page.locator('#project-name')).toHaveValue('New project');
    await expect(page.locator('#save-project')).toHaveText('Save name');
    await expect(page.locator('#project-filter .picker-option', { hasText: 'New project' })).toHaveCount(1);
    await choose(page.locator('#managed-project'), projectId);
    await page.locator('#project-name').fill('Renamed project');
    await page.locator('#save-project').click();
    await expect(page.locator('#project-feedback')).toHaveText('Project renamed.');
    await expect(page.locator(`[data-ticket-id="${assignedId}"] .project-badge`)).toHaveText('Renamed project');
    await expect(page.locator('#delete-project')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#project-dialog')).not.toBeVisible();
});

test('shows project validation and missing-project errors and preserves input for retry', async t => {
    const { page, state } = await workspace(t);
    await page.locator('#manage-projects').click();
    for (const id of ['', otherProjectId]) {
        await choose(page.locator('#managed-project'), id);
        for (const name of ['   ', 'x'.repeat(201)]) {
            await page.locator('#project-name').fill(name);
            await page.locator('#save-project').click();
            await expect(page.locator('#project-feedback')).toContainText('HTTP 400');
            await expect(page.locator('#project-name')).toHaveValue(name);
            await expect(page.locator('#save-project')).toBeEnabled();
        }
    }
    state.projects = state.projects.filter(project => project.id !== otherProjectId);
    await page.locator('#project-name').fill('Missing project');
    await page.locator('#save-project').click();
    await expect(page.locator('#project-feedback')).toContainText('HTTP 404: Project not found.');
    await expect(page.locator('#project-name')).toHaveValue('Missing project');
    await expect(page.locator('#close-projects')).toBeEnabled();
    await page.locator('#close-projects').click();
    await page.locator('#refresh').click();
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#managed-project .picker-option', { hasText: 'Another project', exact: true })).toHaveCount(0);
});

test('keeps tickets usable when the project API is unavailable', async t => {
    const { page, state } = await workspace(t, { projectsUnavailable: true });
    await expect(page.locator('#project-notice')).toBeVisible();
    await expect(page.locator('.create-project').first().locator('.picker-trigger')).toBeDisabled();
    await choose(page.locator('#project-filter'), projectId);
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
    await choose(card.locator('.ticket-project-select'), projectId);
    await expect(card.locator('.ticket-feedback')).toContainText('project assignment was not applied');
    await expect(card.locator('.project-badge')).toHaveText('Unassigned');
    await choose(page.locator('[data-status="TODO"] .create-project'), projectId);
    await page.locator('#todo-title').fill('Created without expected project');
    await page.locator('[data-status="TODO"] .create-form button[type="submit"]').click();
    await expect(page.locator('#todo-create-error')).toContainText('project assignment was not applied');
    await expect(page.locator('#todo-title')).toHaveValue('');
});

test('shows assignment errors and restores controls for retry', async t => {
    const { page } = await workspace(t, { rejectUpdate: true });
    const card = page.locator(`[data-ticket-id="${assignedId}"]`);
    await card.locator('.ticket-menu-trigger').click();
    await choose(card.locator('.ticket-project-select'), otherProjectId);
    await expect(card.locator('.ticket-feedback')).toContainText('Assignment rejected.');
    await expect(card.locator('.ticket-project-select').locator('.picker-trigger')).toBeEnabled();
    await expect(card.locator('.ticket-project-select')).toHaveJSProperty('value', projectId);
    await expect(card.locator('.project-badge')).toHaveText('Workboard');
});

test('stays light and within the mobile viewport regardless of system appearance', async t => {
    for (const colorScheme of ['light', 'dark']) {
        const { page } = await workspace(t, { context: { viewport: { width: 390, height: 844 }, colorScheme } });
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(255, 255, 255)');
        await page.locator('#manage-projects').click();
        await expect(page.locator('#project-dialog')).toBeVisible();
        await capture(page, `mobile-dialog-${colorScheme}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await page.keyboard.press('Escape');
        await choose(page.locator('#project-filter'), projectId);
        await expect(page.locator('.ticket:visible')).toHaveCount(1);
        await capture(page, `mobile-board-${colorScheme}`);
    }
});

test('handles crowded boards, long names and ticket menus on tablet and small mobile', async t => {
    for (const width of [960, 320]) {
        const { page, state } = await workspace(t, { context: { viewport: { width, height: 900 }, colorScheme: 'dark' } });
        state.projects[0].name = 'A'.repeat(200);
        state.tickets = Array.from({ length: 9 }, (_, index) => ({
            id: `00000000-0000-0000-0000-${String(index + 21).padStart(12, '0')}`,
            title: index === 0 ? 'A'.repeat(200) : ['Review the release checklist', 'Refine project validation', 'Ship the project API'][index % 3],
            status: ['TODO', 'DOING', 'DONE'][index % 3],
            blocked: index === 0,
            blockedNote: index === 0 ? 'Waiting for the API contract review' : null,
            projectId: index % 2 ? null : projectId,
            completedAt: null
        }));
        await page.locator('#refresh').click();
    await expect(page.locator('#refresh')).toBeEnabled();
        await expect(page.locator('.ticket')).toHaveCount(9);
        await expect(page.locator('#project-summary')).toHaveText('9 tickets');
        const card = page.locator('.ticket').first();
        await card.locator('.ticket-menu-trigger').focus();
        await page.keyboard.press('ArrowDown');
        await expect(card.locator('.ticket-project-select').locator('.picker-trigger')).toBeFocused();
        const bounds = await card.locator('.ticket-menu-items').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        await capture(page, `crowded-${width}-dark`);
        await page.keyboard.press('Escape');
        await expect(card.locator('.ticket-menu-trigger')).toBeFocused();
        await expect(card.locator('.ticket-menu-items')).toBeHidden();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    }
});

test('custom project pickers support keyboard selection, typeahead and dismissal', async t => {
    const { page } = await workspace(t);
    const picker = page.locator('#project-filter');
    const trigger = picker.locator('.picker-trigger');
    await expect(page.locator('select')).toHaveCount(0);
    await trigger.focus();
    await trigger.press('End');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await capture(page, 'custom-project-picker');
    await trigger.press('Enter');
    await expect(picker).toHaveJSProperty('value', projectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await trigger.press('Home');
    await trigger.press('Escape');
    await expect(picker).toHaveJSProperty('value', projectId);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.press('a');
    await trigger.press('n');
    await trigger.press('Enter');
    await expect(picker).toHaveJSProperty('value', otherProjectId);
    await expect(page.locator('.ticket:visible')).toHaveCount(0);
    await trigger.click();
    await page.locator('#ticket-search').click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#manage-projects').click();
    const managed = page.locator('#managed-project .picker-trigger');
    await managed.click();
    await managed.press('Escape');
    await expect(page.locator('#project-dialog')).toBeVisible();
    await expect(managed).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('#project-dialog')).not.toBeVisible();
});

test('moves tickets with visible arrows and uses a custom deletion confirmation', async t => {
    const { page, state } = await workspace(t);
    const card = page.locator(`[data-ticket-id="${assignedId}"]`);
    assert.equal(await card.evaluate(node => node.draggable), false);
    await expect(page.locator('.drag-handle')).toHaveCount(0);
    await expect(card.locator('.move-action')).toHaveCount(1);
    await card.getByRole('button', { name: /Start ticket/ }).click();
    await expect(page.locator('[data-status="DOING"] .ticket')).toHaveCount(2);
    await expect(card.locator('.move-action')).toHaveCount(2);
    await card.getByRole('button', { name: /Complete ticket/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-status="DONE"] .ticket')).toHaveCount(1);
    await expect(card.locator('.move-action')).toHaveCount(1);
    await card.locator('.ticket-menu-trigger').click();
    await card.getByRole('button', { name: /Delete ticket/ }).click();
    await expect(page.locator('#delete-dialog')).toBeVisible();
    await expect(page.locator('#cancel-delete')).toBeFocused();
    await capture(page, 'delete-confirmation');
    await page.locator('#cancel-delete').click();
    await expect(card).toBeVisible();
    assert.equal(state.writes.filter(write => write.method === 'DELETE').length, 0);
    await card.locator('.ticket-menu-trigger').click();
    await card.getByRole('button', { name: /Delete ticket/ }).click();
    await page.locator('#confirm-delete').click();
    await expect(card).toHaveCount(0);
    assert.equal(state.writes.filter(write => write.method === 'DELETE').length, 1);
});

test('search supports multiple words, literal punctuation, highlights and keyboard navigation', async t => {
    const { page, state } = await workspace(t);
    state.tickets[0].title = 'Review [draft] API <img src=x>';
    await page.locator('#refresh').click();
    await expect(page.locator('#refresh')).toBeEnabled();
    const search = page.locator('#ticket-search');
    const card = page.locator(`[data-ticket-id="${assignedId}"]`);
    await page.keyboard.press('Control+k');
    await expect(search).toBeFocused();
    await search.fill('  API   workboard  ');
    await expect(page.locator('.ticket:visible')).toHaveCount(1);
    await expect(page.locator('#search-count')).toHaveText('1 / 2');
    await expect(card.locator('.ticket-title mark')).toHaveText('API');
    await expect(card.locator('.project-badge mark')).toHaveText('Workboard');
    await capture(page, 'search-results');
    await search.press('Enter');
    await expect(card.locator('.ticket-title')).toBeFocused();
    await expect(card.locator('textarea')).toHaveCount(0);
    await page.keyboard.press('Meta+k');
    await expect(search).toBeFocused();
    await search.fill('[draft]');
    await expect(card.locator('.ticket-title mark')).toHaveText('[draft]');
    await search.fill('<img src=x>');
    await expect(card).toBeVisible();
    await expect(card.locator('.ticket-title img')).toHaveCount(0);
    await page.locator('#clear-search').click();
    await expect(search).toBeFocused();
    await expect(card.locator('mark')).toHaveCount(0);
    await choose(page.locator('#project-filter'), projectId);
    await search.fill('000000000011');
    await expect(card).toBeVisible();
    await page.locator('#clear-search').click();
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', projectId);
    await search.fill('no such ticket');
    await expect(page.locator('#search-count')).toHaveText('0 / 1');
    await search.press('Enter');
    await expect(search).toBeFocused();
    await capture(page, 'search-empty');
    await search.press('Escape');
    await expect(card).toBeVisible();
    await page.setViewportSize({ width: 320, height: 720 });
    await search.fill('API workboard');
    await expect(page.locator('#search-count')).toHaveText('1 / 1');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await capture(page, 'search-mobile');
});

test('deletes empty projects with confirmation, handles failures, and protects assigned projects', async t => {
    const { page, state } = await workspace(t);
    await choose(page.locator('#project-filter'), otherProjectId);
    await page.locator('#manage-projects').click();
    await expect(page.locator('#delete-project')).toBeHidden();
    await choose(page.locator('#managed-project'), projectId);
    await expect(page.locator('#delete-project')).toBeDisabled();
    await expect(page.locator('#project-delete-note')).toBeVisible();
    await choose(page.locator('#managed-project'), otherProjectId);
    await expect(page.locator('#delete-project')).toBeEnabled();
    await page.locator('#delete-project').click();
    await expect(page.locator('#delete-title')).toHaveText('Delete project?');
    await expect(page.locator('#delete-description')).toContainText('Another project');
    await capture(page, 'delete-project');
    await page.locator('#cancel-delete').click();
    assert.equal(state.writes.length, 0);
    state.projectDeleteFailure = 409;
    await page.locator('#delete-project').click();
    await page.locator('#confirm-delete').click();
    await expect(page.locator('#project-feedback')).toHaveText('HTTP 409: Project has assigned tickets.');
    await expect(page.locator('#managed-project')).toHaveJSProperty('value', otherProjectId);
    await expect(page.locator('#project-name')).toHaveValue('Another project');
    await expect(page.locator('#delete-project')).toBeEnabled();
    state.projectDeleteFailure = 500;
    await page.locator('#delete-project').click();
    await page.locator('#confirm-delete').click();
    await expect(page.locator('#project-feedback')).toContainText('HTTP 500:');
    await expect(page.locator('#managed-project')).toHaveJSProperty('value', otherProjectId);
    state.projects = state.projects.filter(project => project.id !== otherProjectId);
    await page.locator('#delete-project').click();
    await page.locator('#confirm-delete').click();
    await expect(page.locator('#project-feedback')).toHaveText('HTTP 404: Project not found.');
    state.projects.push({ id: otherProjectId, name: 'Another project' });
    state.projectDeleteFailure = null;
    await page.locator('#delete-project').click();
    await page.locator('#confirm-delete').click();
    await expect(page.locator('#project-feedback')).toHaveText('Project deleted.');
    await expect(page.locator('#managed-project')).toHaveJSProperty('value', '');
    await expect(page.locator('#delete-project')).toBeHidden();
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', 'all');
    await expect(page.locator('#project-filter .picker-option[data-value="' + otherProjectId + '"]')).toHaveCount(0);
    assert.equal(state.projects.some(project => project.id === otherProjectId), false);
});

test('remembers dropdown selections independently across reloads and resets them deliberately', async t => {
    const { page } = await workspace(t);
    await choose(page.locator('#project-filter'), projectId);
    await choose(page.locator('[data-status="TODO"] .create-project'), otherProjectId);
    await choose(page.locator('[data-status="DOING"] .create-project'), '');
    await page.locator('#manage-projects').click();
    await choose(page.locator('#managed-project'), otherProjectId);
    await page.locator('#close-projects').click();
    await page.reload();
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', projectId);
    await expect(page.locator('[data-status="TODO"] .create-project')).toHaveJSProperty('value', otherProjectId);
    await expect(page.locator('[data-status="DOING"] .create-project')).toHaveJSProperty('value', '');
    await expect(page.locator('[data-status="DONE"] .create-project')).toHaveJSProperty('value', projectId);
    await page.locator('#manage-projects').click();
    await expect(page.locator('#managed-project')).toHaveJSProperty('value', otherProjectId);
    await expect(page.locator('#project-name')).toHaveValue('Another project');
    await page.locator('#close-projects').click();
    await page.locator('#clear-filters').click();
    await page.reload();
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', 'all');
    for (const status of ['TODO', 'DOING', 'DONE']) {
        await expect(page.locator(`[data-status="${status}"] .create-project`)).toHaveJSProperty('value', '');
    }
});

test('drops deleted project preferences and keeps ticket assignments authoritative', async t => {
    const { page, state } = await workspace(t);
    await page.evaluate(({ project, other, ticket }) => {
        localStorage.setItem('workboard.dropdowns.v1.user-1', JSON.stringify({
            filter: other, managed: other,
            create: { TODO: other, DOING: project, DONE: '' },
            tickets: { [ticket]: other }
        }));
    }, { project: projectId, other: otherProjectId, ticket: assignedId });
    state.projects = state.projects.filter(project => project.id !== otherProjectId);
    await page.reload();
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', 'all');
    await expect(page.locator('#managed-project')).toHaveJSProperty('value', '');
    await expect(page.locator('[data-status="TODO"] .create-project')).toHaveJSProperty('value', '');
    await expect(page.locator('[data-status="DOING"] .create-project')).toHaveJSProperty('value', projectId);
    await expect(page.locator(`[data-ticket-id="${assignedId}"] .ticket-project-select`)).toHaveJSProperty('value', projectId);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('workboard.dropdowns.v1.user-1')));
    assert.equal(stored.filter, 'all');
    assert.equal(stored.managed, '');
    assert.equal(stored.create.TODO, '');
});

test('preserves dropdown preferences through a temporary project catalog failure', async t => {
    const { page, state } = await workspace(t);
    await choose(page.locator('#project-filter'), otherProjectId);
    await choose(page.locator('[data-status="DOING"] .create-project'), projectId);
    const before = await page.evaluate(() => localStorage.getItem('workboard.dropdowns.v1.user-1'));
    state.projectsUnavailable = true;
    await page.reload();
    await expect(page.locator('#project-notice')).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem('workboard.dropdowns.v1.user-1')), before);
    state.projectsUnavailable = false;
    await page.locator('#refresh').click();
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', otherProjectId);
    await expect(page.locator('[data-status="DOING"] .create-project')).toHaveJSProperty('value', projectId);
});

test('recovers from malformed dropdown preferences and works when storage is blocked', async t => {
    const { page } = await workspace(t);
    await page.evaluate(() => localStorage.setItem('workboard.dropdowns.v1.user-1', '{invalid'));
    await page.reload();
    await expect(page.locator('#refresh')).toBeEnabled();
    await choose(page.locator('#project-filter'), projectId);
    await page.reload();
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', projectId);
    const unavailable = await workspace(t, { storageUnavailable: true });
    await choose(unavailable.page.locator('#project-filter'), projectId);
    await expect(unavailable.page.locator('.ticket:visible')).toHaveCount(1);
    await choose(unavailable.page.locator('[data-status="TODO"] .create-project'), otherProjectId);
    await expect(unavailable.page.locator('[data-status="TODO"] .create-project')).toHaveJSProperty('value', otherProjectId);
});


test('checks the session before loading private resources and logs in with CSRF headers', async t => {
    const { page, state } = await workspace(t, { state: { authenticated: false } });
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('.header-actions')).toBeHidden();
    assert.deepEqual(state.requests.map(request => request.resource), ['auth']);
    await page.locator('#auth-email').fill('alex@example.com');
    await page.locator('#auth-password').fill('my example password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#feedback')).toHaveText('Tickets refreshed.');
    await expect(page.locator('#account-email')).toHaveText('alex@example.com');
    assert.equal(state.authWrites[0].id, 'login');
    assert.equal(state.authWrites[0].headers.origin, origin);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /token|session|password/i.test(key))), false);
});

test('registers then logs in and applies registration password requirements', async t => {
    const { page, state } = await workspace(t, { state: { authenticated: false } });
    await page.locator('#auth-switch').click();
    await expect(page.locator('#auth-title')).toHaveText('Create your account');
    await expect(page.locator('#auth-password')).toHaveAttribute('autocomplete', 'new-password');
    await page.locator('#auth-email').fill('new@example.com');
    await page.locator('#auth-password').fill('short');
    await page.locator('#auth-submit').click();
    assert.equal(state.authWrites.length, 0);
    await page.locator('#auth-password').fill('my new example password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#workspace')).toBeVisible();
    assert.deepEqual(state.authWrites.map(write => write.id), ['register', 'login']);
});

test('keeps failed login and duplicate registration on the authentication form', async t => {
    const { page, state } = await workspace(t, { state: { authenticated: false, loginFailure: 'Invalid email or password.' } });
    await page.locator('#auth-email').fill('alex@example.com');
    await page.locator('#auth-password').fill('incorrect password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-feedback')).toContainText('Invalid email or password.');
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#auth-password')).toHaveValue('');
    await expect(page.locator('#auth-submit')).toBeEnabled();
    await page.locator('#auth-switch').click();
    state.registrationFailure = 'Email is already registered.';
    await page.locator('#auth-password').fill('my example password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-feedback')).toContainText('Email is already registered.');
    assert.deepEqual(state.authWrites.map(write => write.id), ['login', 'register']);
});

test('does not repeat registration when the subsequent login fails', async t => {
    const { page, state } = await workspace(t, { state: { authenticated: false, loginFailure: 'Login temporarily unavailable.' } });
    await page.locator('#auth-switch').click();
    await page.locator('#auth-email').fill('new@example.com');
    await page.locator('#auth-password').fill('my example password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-feedback')).toContainText('Your account was created. Log in to continue.');
    await expect(page.locator('#auth-submit')).toHaveText('Log in');
    state.loginFailure = null;
    await page.locator('#auth-password').fill('my example password');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#workspace')).toBeVisible();
    assert.deepEqual(state.authWrites.map(write => write.id), ['register', 'login', 'login']);
});

test('clears private data and closes dialogs when a board request returns 401', async t => {
    const { page, state } = await workspace(t);
    await page.locator('#manage-projects').click();
    await expect(page.locator('#project-dialog')).toBeVisible();
    state.authenticated = false;
    await page.locator('#project-name').fill('Expired session');
    await page.locator('#save-project').click();
    await expect(page.locator('#auth-feedback')).toHaveText('Your session has expired. Log in again to continue.');
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#project-dialog')).not.toBeVisible();
    await expect(page.locator('.ticket')).toHaveCount(0);
    await expect(page.locator('#account-email')).toHaveText('');
    await expect(page.locator('#auth-email')).toBeFocused();
});

test('logs out and preserves the board when logout fails', async t => {
    const { page, state } = await workspace(t, { state: { logoutFailure: true } });
    await page.locator('#logout').click();
    await expect(page.locator('#feedback')).toContainText('Could not log out.');
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#logout')).toBeEnabled();
    state.logoutFailure = false;
    await page.locator('#logout').click();
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    assert.equal(state.authenticated, false);
    assert.equal(state.authWrites.at(-1).id, 'logout');
});

test('retries session restoration without exposing the board on server failure', async t => {
    const { page, state } = await workspace(t, { state: { sessionUnavailable: true } });
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#auth-form')).toBeHidden();
    assert.equal(state.requests.some(request => request.resource !== 'auth'), false);
    state.sessionUnavailable = false;
    await page.locator('#retry-session').click();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#feedback')).toHaveText('Tickets refreshed.');
});

test('keeps saved dropdown choices separate between accounts', async t => {
    const { page, state } = await workspace(t);
    await choose(page.locator('#project-filter'), projectId);
    state.user = { id: 'user-2', email: 'other@example.com' };
    await page.reload();
    await expect(page.locator('#feedback')).toHaveText('Tickets refreshed.');
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', 'all');
    state.user = { id: 'user-1', email: 'alex@example.com' };
    await page.reload();
    await expect(page.locator('#feedback')).toHaveText('Tickets refreshed.');
    await expect(page.locator('#project-filter')).toHaveJSProperty('value', projectId);
});

test('authentication forms fit a narrow screen and ignore board keyboard shortcuts', async t => {
    const { page } = await workspace(t, {
        context: { viewport: { width: 320, height: 740 } },
        state: { authenticated: false }
    });
    await page.locator('#auth-email').focus();
    await page.keyboard.press('Control+k');
    await expect(page.locator('#auth-email')).toBeFocused();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await capture(page, 'auth-mobile-login');
    await page.locator('#auth-switch').click();
    await capture(page, 'auth-mobile-register');
});
