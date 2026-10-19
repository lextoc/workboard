const feedback = document.querySelector('#feedback');
const refreshButton = document.querySelector('#refresh');
const projectFilter = document.querySelector('#project-filter');
const projectSummary = document.querySelector('#project-summary');
const manageProjectsButton = document.querySelector('#manage-projects');
const projectNotice = document.querySelector('#project-notice');
const projectDialog = document.querySelector('#project-dialog');
const managedProject = document.querySelector('#managed-project');
const projectForm = document.querySelector('#project-form');
const projectNameInput = document.querySelector('#project-name');
const projectFeedback = document.querySelector('#project-feedback');
const saveProjectButton = document.querySelector('#save-project');
const ticketSearch = document.querySelector('#ticket-search');
const clearSearch = document.querySelector('#clear-search');
const searchCount = document.querySelector('#search-count');
const deleteProjectButton = document.querySelector('#delete-project');
const blockedFilter = document.querySelector('#blocked-filter');
const clearFilters = document.querySelector('#clear-filters');
const statuses = ['TODO', 'DOING', 'DONE'];
const savedTickets = new Map();
const pendingTickets = new Set();
const editingTickets = new Set();
const savedProjects = new Map();
let dropdownStorageKey = null;
let dropdownPreferences = {};
let currentAccount = null;
let sessionGeneration = 0;
let authMode = 'login';
let authBusy = false;
const authPanel = document.querySelector('#auth-panel');
const authForm = document.querySelector('#auth-form');
const authFeedback = document.querySelector('#auth-feedback');
const authPassword = document.querySelector('#auth-password');
const authSubmit = document.querySelector('#auth-submit');
const authSwitch = document.querySelector('#auth-switch');
const retrySession = document.querySelector('#retry-session');
const workspace = document.querySelector('#workspace');
const headerActions = document.querySelector('.header-actions');
const logoutButton = document.querySelector('#logout');
let dropdownsRestored = false;
let refreshing = false;
let pendingCreates = 0;
let projectCatalogReady = false;
let pendingProject = false;

function readDropdownPreferences() {
    try {
        const saved = JSON.parse(localStorage.getItem(dropdownStorageKey));
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
        return {
            filter: typeof saved.filter === 'string' ? saved.filter : 'all',
            managed: typeof saved.managed === 'string' ? saved.managed : '',
            create: Object.fromEntries(statuses.flatMap(status =>
                typeof saved.create?.[status] === 'string' ? [[status, saved.create[status]]] : []))
        };
    } catch {
        return {};
    }
}

function persistDropdownPreferences() {
    if (!dropdownStorageKey || !currentAccount) return;
    dropdownPreferences.filter = projectFilter.value;
    if (projectCatalogReady && dropdownsRestored) {
        dropdownPreferences.managed = managedProject.value;
        dropdownPreferences.create = Object.fromEntries([...document.querySelectorAll('.create-project')]
            .map(picker => [picker.closest('.column').dataset.status, picker.value]));
    }
    try {
        localStorage.setItem(dropdownStorageKey, JSON.stringify(dropdownPreferences));
    } catch {}
}

function restoreDropdownPreferences() {
    if (!dropdownsRestored) {
        const filter = dropdownPreferences.filter ?? 'all';
        projectFilter.value = projectFilter.options.some(option => option.value === filter) ? filter : 'all';
        const defaultProject = ['all', 'unassigned'].includes(projectFilter.value) ? '' : projectFilter.value;
        document.querySelectorAll('.create-project').forEach(picker => {
            const status = picker.closest('.column').dataset.status;
            populateProjectSelect(picker, dropdownPreferences.create?.[status] ?? defaultProject);
        });
        populateProjectSelect(managedProject, dropdownPreferences.managed ?? '', 'New project');
        updateProjectForm();
        dropdownsRestored = projectCatalogReady;
        applyProjectFilter();
    }
    if (projectCatalogReady) persistDropdownPreferences();
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text, className, label) {
    const node = element('button', className, text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    return node;
}

function icon(name) {
    const paths = {
        block: 'M6 6l12 12M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
        trash: 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6',
        left: 'M19 12H5m6-6-6 6 6 6',
        right: 'M5 12h14m-6-6 6 6-6 6',
        plus: 'M12 5v14M5 12h14',
        more: 'M5 12h.01M12 12h.01M19 12h.01'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    svg.append(path);
    return svg;
}

function actionButton(text, iconName, className, label) {
    const control = button('', className, label);
    control.append(icon(iconName));
    if (text) control.append(element('span', '', text));
    return control;
}

function showFeedback(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
    feedback.classList.toggle('sr-only', message === 'Tickets refreshed.');
}

function apiErrorMessage(response, data, body) {
    const text = value => typeof value === 'string' ? value.trim() : '';
    const labels = {
        title: 'Title',
        status: 'Status',
        blocked: 'Blocked',
        blockedNote: 'Blocking reason',
        projectId: 'Project',
        name: 'Project name',
        email: 'Email',
        password: 'Password'
    };
    const violations = Array.isArray(data?.violations)
        ? data.violations.flatMap(item => {
            const message = text(item?.message);
            if (!message) return [];
            const path = text(item?.field);
            const field = path.split('.').pop();
            return [path ? `${labels[field] || path}: ${message}` : message];
        })
        : [];
    if (violations.length) {
        return `HTTP ${response.status}:\n${[...new Set(violations)].join('\n')}`;
    }

    const detail = text(data?.detail) || text(data?.message) || text(data?.error)
        || text(data?.details).split('\n')[0] || text(data?.title) || text(data);
    const plainText = data === null && !response.headers.get('content-type')?.includes('html')
        && !body.trimStart().startsWith('<') ? body.trim() : '';
    const fallback = response.status >= 500
        ? 'The server could not process the request. Check the server logs for the cause.'
        : response.status === 400 || response.status === 422
            ? 'The server rejected the submitted values without an explanation. The API must return a validation message.'
            : response.status === 404
                ? 'This item could not be found. Refresh the board and try again.'
                : 'The server rejected the request without an explanation.';
    return `HTTP ${response.status}: ${(detail || plainText || fallback).slice(0, 1500)}`;
}

async function api(path = '', options = {}, resource = 'tickets') {
    const generation = sessionGeneration;
    const method = (options.method ?? 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-Workboard-Request', '1');
    let response;
    let body;
    try {
        response = await fetch(`/api/${resource}${path}`, {
            ...options,
            method,
            credentials: 'same-origin',
            headers
        });
        body = await response.text();
    } catch {
        throw new Error('Could not read a response from the API. Check your connection and refresh the board to confirm the saved state.');
    }
    let data;
    try {
        data = body ? JSON.parse(body) : null;
    } catch {
        data = null;
    }
    if (resource !== 'auth' && generation !== sessionGeneration) {
        throw new Error('The session changed. Log in again to continue.');
    }
    if (!response.ok) {
        const error = new Error(apiErrorMessage(response, data, body));
        error.status = response.status;
        if (response.status === 401 && resource !== 'auth') {
            showSignedOut('Your session has expired. Log in again to continue.', true);
        }
        throw error;
    }
    if (body && data === null && response.status !== 204) {
        throw new Error('The server returned an unexpected response. Refresh to check the saved state.');
    }
    return data;
}

function cardFor(id) {
    return document.querySelector(`[data-ticket-id="${id}"]`);
}

function updateRefresh() {
    const busy = refreshing || pendingTickets.size > 0 || pendingCreates > 0 || pendingProject;
    logoutButton.disabled = busy || editingTickets.size > 0 || authBusy;
    refreshButton.disabled = busy;
    projectFilter.disabled = busy || editingTickets.size > 0;
    manageProjectsButton.disabled = busy || editingTickets.size > 0;
    ticketSearch.disabled = busy || editingTickets.size > 0;
    blockedFilter.disabled = busy || editingTickets.size > 0;
    clearFilters.disabled = busy || editingTickets.size > 0;
    clearSearch.disabled = busy || editingTickets.size > 0;
}

function normalizeTicket(ticket) {
    return {
        ...ticket,
        projectId: ticket.projectId ?? ticket.project?.id ?? null,
        projectName: ticket.projectName ?? ticket.project?.name ?? null
    };
}

function knownProjects() {
    const projects = new Map(savedProjects);
    for (const ticket of savedTickets.values()) {
        if (ticket.projectId && !projects.has(String(ticket.projectId))) {
            projects.set(String(ticket.projectId), { id: String(ticket.projectId), name: ticket.projectName ?? 'Unnamed project' });
        }
    }
    return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function searchWords() {
    return [...new Set(ticketSearch.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))];
}

function matchesScope(ticket) {
    return (projectFilter.value === 'all'
        || (projectFilter.value === 'unassigned' ? !ticket.projectId : String(ticket.projectId) === projectFilter.value))
        && (blockedFilter.getAttribute('aria-pressed') !== 'true' || ticket.blocked);
}

function matchesView(ticket) {
    const content = [ticket.title, ticket.projectName, ticket.blockedNote, ticket.id].filter(Boolean).join(' ').toLocaleLowerCase();
    return matchesScope(ticket) && searchWords().every(word => content.includes(word));
}

function highlightSearch(node, text) {
    if (!node) return;
    const words = searchWords();
    node.replaceChildren();
    if (!words.length) { node.textContent = text; return; }
    const pattern = new RegExp(words.sort((a, b) => b.length - a.length)
        .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
        node.append(document.createTextNode(text.slice(offset, match.index)), element('mark', '', match[0]));
        offset = match.index + match[0].length;
    }
    node.append(document.createTextNode(text.slice(offset)));
}

function updateProjectFilter() {
    const selected = projectFilter.value;
    projectFilter.setOptions([{ value: 'all', textContent: 'All projects' }, { value: 'unassigned', textContent: 'Unassigned' },
        ...knownProjects().map(project => ({ value: project.id, textContent: project.name }))]);
    projectFilter.value = [...projectFilter.options].some(option => option.value === selected) ? selected : 'all';
}

function applyProjectFilter() {
    closeTicketMenus();
    for (const ticket of savedTickets.values()) {
        const card = cardFor(ticket.id);
        if (card) {
            card.hidden = !matchesView(ticket);
            highlightSearch(card.querySelector('.ticket-title'), ticket.title);
            highlightSearch(card.querySelector('.project-badge'), ticket.projectId ? ticket.projectName ?? 'Unnamed project' : 'Unassigned');
            highlightSearch(card.querySelector('.blocker-preview'), ticket.blockedNote ?? '');
        }
    }
    const tickets = [...savedTickets.values()];
    const count = tickets.filter(matchesView).length;
    const scopeCount = tickets.filter(matchesScope).length;
    const query = ticketSearch.value.trim();
    const filtered = projectFilter.value !== 'all' || query || blockedFilter.getAttribute('aria-pressed') === 'true';
    clearFilters.hidden = !filtered;
    clearSearch.hidden = !ticketSearch.value;
    searchCount.hidden = !query;
    searchCount.textContent = `${count} / ${scopeCount}`;
    document.querySelector('#search-shortcut').hidden = Boolean(ticketSearch.value);
    const countLabel = query ? `${count} of ${scopeCount} ${scopeCount === 1 ? 'ticket' : 'tickets'}` : `${count} ${count === 1 ? 'ticket' : 'tickets'}`;
    projectSummary.textContent = `${countLabel}${projectFilter.value !== 'all' ? ` · ${projectFilter.selectedOptions[0].textContent}` : ''}${blockedFilter.getAttribute('aria-pressed') === 'true' ? ' · Blocked' : ''}${query ? ` for “${query}”` : ''}`;
    updateColumns();
}

function populateProjectSelect(select, selected, emptyLabel = 'Unassigned') {
    select.setOptions([{ value: '', textContent: emptyLabel },
        ...knownProjects().map(project => ({ value: project.id, textContent: project.name }))]);
    select.value = selected ?? '';
    if (select.selectedIndex < 0) select.value = '';
    select.disabled = !projectCatalogReady;
}

function syncProjectControls() {
    document.querySelectorAll('.create-project').forEach(select => {
        populateProjectSelect(select, select.value);
    });
    document.querySelectorAll('.ticket-project-select').forEach(select => {
        const ticket = savedTickets.get(select.dataset.projectTicketId);
        populateProjectSelect(select, ticket?.projectId);
    });
    populateProjectSelect(managedProject, managedProject.value, 'New project');
    updateProjectForm();
}

function updateProjectForm() {
    const project = savedProjects.get(managedProject.value);
    projectNameInput.value = project?.name ?? '';
    saveProjectButton.textContent = project ? 'Save name' : 'Create project';
    projectForm.querySelectorAll('input, button').forEach(control => {
        control.disabled = pendingProject || !projectCatalogReady;
    });
    managedProject.disabled = pendingProject || !projectCatalogReady;
    deleteProjectButton.hidden = !project;
    const assigned = project && [...savedTickets.values()].some(ticket => String(ticket.projectId) === managedProject.value);
    deleteProjectButton.disabled = pendingProject || !projectCatalogReady || assigned;
    document.querySelector('#project-delete-note').hidden = !assigned;
}

async function loadProjects() {
    try {
        const projects = await api('', {}, 'projects');
        if (!Array.isArray(projects) || projects.some(project => !project?.id || typeof project.name !== 'string')) {
            throw new Error('Expected a project list from the server.');
        }
        savedProjects.clear();
        projects.forEach(project => savedProjects.set(String(project.id), project));
        projectCatalogReady = true;
        projectNotice.hidden = true;
    } catch (error) {
        projectCatalogReady = false;
        projectNotice.textContent = 'Project management and assignment are unavailable. You can still view and filter existing assignments. Refresh the board to retry.';
        projectNotice.hidden = false;
        projectFeedback.textContent = error.message;
        projectFeedback.classList.add('error');
    }
    syncProjectControls();
}

function updateColumns() {
    for (const status of statuses) {
        const column = document.querySelector(`[data-status="${status}"]`);
        const cards = column.querySelector('.cards');
        const count = cards.querySelectorAll('.ticket:not([hidden])').length;
        column.querySelector('.count').textContent = count;
        cards.querySelector('.empty')?.remove();
        if (!count) {
            const filtered = projectFilter.value !== 'all' || ticketSearch.value.trim() || blockedFilter.getAttribute('aria-pressed') === 'true';
            const empty = element('div', 'empty');
            empty.append(element('strong', '', filtered ? 'No matching tickets' : 'No tickets'));
            cards.append(empty);
        }
    }
}

function placeTicket(ticket, focusTarget) {
    ticket = normalizeTicket(ticket);
    const id = String(ticket.id);
    savedTickets.set(id, ticket);
    const oldCard = cardFor(id);
    const card = ticketCard(ticket);
    const cards = document.querySelector(`[data-status="${ticket.status}"] .cards`);
    if (oldCard?.parentElement === cards) {
        oldCard.replaceWith(card);
    } else {
        oldCard?.remove();
        const next = [...cards.querySelectorAll('.ticket')]
            .find(item => item.dataset.ticketId > id);
        cards.insertBefore(card, next ?? null);
    }
    updateProjectFilter();
    applyProjectFilter();
    if (focusTarget) card.querySelector(focusTarget)?.focus();
}

async function runCard(id, action, focusTarget = '.ticket-title') {
    id = String(id);
    if (refreshing || pendingTickets.has(id)) return;
    const card = cardFor(id);
    const focused = document.activeElement;
    const controls = [...card.querySelectorAll('project-picker, button, input, textarea')];
    const disabled = controls.map(control => control.disabled);
    pendingTickets.add(id);
    updateRefresh();
    card.setAttribute('aria-busy', 'true');
    controls.forEach(control => { control.disabled = true; });
    const message = card.querySelector('.ticket-feedback');
    message.classList.remove('error', 'sr-only');
    message.textContent = 'Saving…';
    let saved = false;
    try {
        await action();
        saved = true;
    } catch (error) {
        const currentMessage = cardFor(id)?.querySelector('.ticket-feedback') ?? message;
        currentMessage.textContent = error.message;
        currentMessage.classList.remove('sr-only');
        currentMessage.classList.add('error');
        const projectSelect = cardFor(id)?.querySelector('.ticket-project-select');
        if (projectSelect) projectSelect.value = savedTickets.get(id)?.projectId ?? '';
        if (cardFor(id)?.hidden) showFeedback(error.message, true);
    } finally {
        pendingTickets.delete(id);
        updateRefresh();
        if (card.isConnected) {
            card.removeAttribute('aria-busy');
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
        }
        if (cardFor(id)?.hidden) {
            projectFilter.focus();
        } else if (document.activeElement === document.body || card.contains(document.activeElement)) {
            if (saved) cardFor(id)?.querySelector(focusTarget)?.focus();
            else if (focused?.isConnected) {
                const target = focused.closest('[hidden]') ? card.querySelector('.ticket-menu-trigger') : focused;
                target?.focus();
            }
        }
    }
}

async function saveTicket(id, changes) {
    const current = savedTickets.get(String(id));
    await api(`/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: current.title,
            status: current.status,
            blocked: current.blocked,
            blockedNote: current.blockedNote,
            projectId: current.projectId,
            ...changes
        })
    });
    const ticket = normalizeTicket(await api(`/${id}`));
    editingTickets.delete(String(id));
    placeTicket(ticket);
    const message = cardFor(id).querySelector('.ticket-feedback');
    message.classList.add('sr-only');
    message.textContent = 'Saved';
    const expectedProjectId = Object.hasOwn(changes, 'projectId') ? changes.projectId : current.projectId;
    if (ticket.projectId !== expectedProjectId) {
        throw new Error('The ticket was saved, but its project assignment was not applied. Refresh the board before trying again.');
    }
    if (!matchesView(ticket)) {
        showFeedback('Ticket saved. It is now outside the selected project view.');
    }
}

function canMove(id, status) {
    const ticket = savedTickets.get(id);
    return ticket && !refreshing && !pendingTickets.has(id) && !editingTickets.has(id)
        && ticket.status !== status;
}

function moveTicket(id, status) {
    if (!canMove(id, status)) return;
    runCard(id, () => saveTicket(id, { status }), '.ticket-menu-trigger');
}

function openInlineEditor(id, mode) {
    if (refreshing || pendingTickets.has(id) || editingTickets.has(id)) return;
    const ticket = savedTickets.get(id);
    const card = cardFor(id);
    editingTickets.add(id);
    updateRefresh();
    card.classList.add('editing');
    closeTicketMenus();
    card.querySelectorAll('button').forEach(control => { control.disabled = true; });
    card.querySelector('.ticket-feedback').textContent = '';
    const original = card.querySelector(mode === 'title' ? '.ticket-heading' : '.blocker-section');
    original.hidden = true;
    const form = element('form', 'inline-editor');
    const field = element('textarea');
    field.id = `edit-${mode}-${id}`;
    field.name = mode;
    field.value = mode === 'title' ? ticket.title : ticket.blockedNote ?? '';
    field.rows = mode === 'title' ? 2 : 3;
    if (mode === 'title') field.autocomplete = 'off';
    const label = element('label', mode === 'title' ? 'sr-only' : '', mode === 'title' ? 'Ticket title' : 'What is blocking this ticket?');
    label.htmlFor = field.id;
    const hint = element('p', 'hint', 'Ctrl/⌘ + Enter to save · Esc to cancel');
    hint.id = `edit-help-${id}`;
    field.setAttribute('aria-describedby', hint.id);
    const actions = element('div', 'inline-actions');
    const save = button('Save', '', `Save ${mode} for ticket ${id}`);
    save.type = 'submit';
    const cancel = button('Cancel', 'quiet');
    const cancelEdit = () => {
        if (pendingTickets.has(id)) return;
        editingTickets.delete(id);
        updateRefresh();
        placeTicket(savedTickets.get(id), mode === 'title' ? '.ticket-title' : '.ticket-menu-trigger');
    };
    cancel.addEventListener('click', cancelEdit);
    form.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        const value = field.value;
        const changes = mode === 'title' ? { title: value } : { blocked: true, blockedNote: value };
        runCard(id, () => saveTicket(id, changes), mode === 'title' ? '.ticket-title' : '.ticket-menu-trigger');
    });
    actions.append(save, cancel);
    form.append(label, field, hint, actions);
    original.after(form);
    field.focus();
    if (mode === 'title') field.select();
}

function closeTicketMenus(except) {
    document.querySelectorAll('.ticket-menu-trigger').forEach(trigger => {
        if (trigger === except) return;
        trigger.dispatchEvent(new Event('close-ticket-menu'));
    });
}

function confirmDeletion(title, kind = 'ticket') {
    const dialog = document.querySelector('#delete-dialog');
    const returnFocus = document.activeElement.closest('.ticket')?.querySelector('.ticket-menu-trigger') ?? document.activeElement;
    document.querySelector('#delete-title').textContent = `Delete ${kind}?`;
    document.querySelector('#confirm-delete').textContent = `Delete ${kind}`;
    document.querySelector('#delete-description').textContent = `“${title}” will be permanently deleted.`;
    dialog.returnValue = '';
    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            returnFocus?.focus();
            resolve(dialog.returnValue === 'delete');
        }, { once: true });
        dialog.showModal();
    });
}

document.querySelector('#cancel-delete').addEventListener('click', () => document.querySelector('#delete-dialog').close());
document.querySelector('#confirm-delete').addEventListener('click', () => document.querySelector('#delete-dialog').close('delete'));

function ticketCard(ticket) {
    const id = String(ticket.id);
    const card = element('article', `ticket${ticket.blocked ? ' blocked' : ''}`);
    card.dataset.ticketId = id;
    card.addEventListener('click', event => {
        if (event.target.closest('.ticket-menu, .inline-editor, .ticket-moves')) return;
        if (editingTickets.has(id)) {
            card.querySelector('textarea[name="title"]')?.focus();
            return;
        }
        openInlineEditor(id, 'title');
    });
    const header = element('div', 'ticket-header');
    const heading = element('h3', 'ticket-heading');
    const title = button(ticket.title, 'ticket-title', `Edit title of ticket ${id}: ${ticket.title}`);
    title.title = ticket.blocked ? `Blocked: ${ticket.blockedNote}` : 'Click to edit title';
    heading.append(title);
    if (ticket.blocked) {
        const badge = element('span', 'blocked-indicator');
        badge.append(icon('block'));
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', 'Blocked');
        badge.title = 'Blocked';
        heading.prepend(badge);
    }
    const menu = element('div', 'ticket-menu');
    const trigger = actionButton('', 'more', 'quiet icon-button ticket-menu-trigger', `Actions for ticket ${id}: ${ticket.title}`);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `ticket-actions-${id}`);
    const panel = element('div', 'ticket-menu-items');
    panel.id = `ticket-actions-${id}`;
    panel.hidden = true;
    panel.append(element('p', 'ticket-reference', `#${id.slice(0, 8)}`));
    panel.querySelector('.ticket-reference').title = id;
    const projectField = element('div', 'ticket-project-field');
    const projectLabel = element('label', '', 'Project');
    const projectSelect = element('project-picker', 'ticket-project-select');
    projectSelect.id = `project-${id}`;
    projectSelect.dataset.projectTicketId = id;
    projectLabel.htmlFor = projectSelect.id;
    populateProjectSelect(projectSelect, ticket.projectId);
    projectSelect.addEventListener('change', () => {
        const projectId = projectSelect.value || null;
        runCard(id, () => saveTicket(id, { projectId }), '.ticket-menu-trigger');
    });
    projectField.append(projectLabel, projectSelect);
    panel.append(projectField);
    let hoverTimer;
    let leaveTimer;
    trigger.addEventListener('close-ticket-menu', () => {
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        trigger.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
    });
    const openMenu = () => {
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        if (!card.isConnected || refreshing || pendingTickets.has(id) || editingTickets.has(id)) return;
        closeTicketMenus(trigger);
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
    };
    trigger.addEventListener('click', () => {
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        if (panel.hidden) openMenu();
        else closeTicketMenus();
    });
    menu.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(leaveTimer);
        hoverTimer = setTimeout(openMenu, 250);
    });
    menu.addEventListener('pointerleave', event => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(hoverTimer);
        leaveTimer = setTimeout(() => {
            if (!menu.contains(document.activeElement)) {
                trigger.setAttribute('aria-expanded', 'false');
                panel.hidden = true;
            }
        }, 250);
    });
    menu.addEventListener('focusout', event => {
        if (menu.contains(event.relatedTarget)) return;
        clearTimeout(hoverTimer);
        clearTimeout(leaveTimer);
        trigger.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
    });
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault();
            clearTimeout(hoverTimer);
            clearTimeout(leaveTimer);
            closeTicketMenus();
            trigger.focus();
        } else if (event.key === 'ArrowDown' && event.target === trigger) {
            event.preventDefault();
            openMenu();
            panel.querySelector('project-picker, button')?.focus();
        }
    });
    const remove = actionButton('Delete ticket', 'trash', 'quiet danger', `Delete ticket ${id}: ${ticket.title}`);
    remove.title = 'Delete ticket';
    remove.addEventListener('click', async () => {
        if (pendingTickets.has(id) || editingTickets.has(id) || refreshing) return;
        if (!await confirmDeletion(ticket.title)) return;
        runCard(id, async () => {
            await api(`/${id}`, { method: 'DELETE' });
            savedTickets.delete(id);
            card.remove();
            updateProjectFilter();
            applyProjectFilter();
            showFeedback(`Deleted ticket #${id.slice(0, 8)}.`);
            if (document.activeElement === document.body) {
                document.querySelector(`[data-status="${ticket.status}"] .create-form input`).focus();
            }
        });
    });
    const blocker = element('div', 'blocker-section');
    if (ticket.blocked) {
        const note = button('', 'blocker-summary', `Edit blocking reason for ticket ${id}: ${ticket.blockedNote}`);
        note.append(element('span', 'blocker-label', 'Blocked · edit reason'), element('span', 'blocker-preview', ticket.blockedNote));
        note.addEventListener('click', () => openInlineEditor(id, 'blocker'));
        const unblock = button('Unblock', 'quiet unblock-action');
        unblock.addEventListener('click', () => runCard(id, () => saveTicket(id, { blocked: false, blockedNote: null }), '.ticket-menu-trigger'));
        panel.append(note, unblock);
    } else {
        const block = actionButton('Block ticket', 'block', 'quiet block-action', `Block ticket ${id}`);
        block.addEventListener('click', () => openInlineEditor(id, 'blocker'));
        panel.append(block);
    }
    const moves = element('div', 'ticket-moves');
    moves.setAttribute('role', 'group');
    moves.setAttribute('aria-label', 'Move ticket');
    const statusIndex = statuses.indexOf(ticket.status);
    for (const direction of [-1, 1]) {
        const destination = statuses[statusIndex + direction];
        if (!destination) continue;
        const labels = { TODO: 'Move to To do', DOING: direction > 0 ? 'Start ticket' : 'Reopen ticket', DONE: 'Complete ticket' };
        const move = actionButton('', direction < 0 ? 'left' : 'right', 'quiet icon-button move-action',
            `${labels[destination]}: move ticket ${id} to ${destination}`);
        move.addEventListener('click', () => moveTicket(id, destination));
        move.title = labels[destination];
        moves.append(move);
    }
    panel.append(remove);
    menu.append(trigger, panel);
    header.append(heading, menu);
    const message = element('p', 'ticket-feedback');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    const projectBadge = element('p', `project-badge${ticket.projectId ? '' : ' unassigned'}`,
        ticket.projectId ? ticket.projectName ?? 'Unnamed project' : 'Unassigned');
    projectBadge.title = ticket.projectName ?? 'No project assigned';
    const footer = element('div', 'ticket-footer');
    footer.append(projectBadge, moves);
    card.append(header, footer, blocker, message);
    return card;
}

async function loadTickets() {
    if (!currentAccount || refreshing || pendingTickets.size || pendingCreates || pendingProject) return;
    const focused = document.activeElement;
    refreshing = true;
    updateRefresh();
    try {
        await loadProjects();
        if (!currentAccount) return false;
        const tickets = await api();
        if (!Array.isArray(tickets)) throw new Error('Expected a ticket list from the server.');
        const received = new Set(tickets.map(ticket => String(ticket.id)));
        for (const id of savedTickets.keys()) {
            if (!received.has(id) && !editingTickets.has(id)) {
                savedTickets.delete(id);
                cardFor(id)?.remove();
            }
        }
        for (const rawTicket of tickets) {
            const ticket = normalizeTicket(rawTicket);
            if (editingTickets.has(String(ticket.id))) savedTickets.set(String(ticket.id), ticket);
            else placeTicket(ticket);
        }
        updateProjectFilter();
        applyProjectFilter();
        syncProjectControls();
        restoreDropdownPreferences();
        showFeedback('Tickets refreshed.');
        return projectCatalogReady;
    } catch (error) {
        showFeedback(error.message, true);
        return false;
    } finally {
        refreshing = false;
        updateRefresh();
        if (focused === refreshButton && document.activeElement === document.body) refreshButton.focus();
    }
}

document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.ticket-menu')) closeTicketMenus();
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeTicketMenus();
});

document.querySelectorAll('.create-form').forEach(form => {
    const input = form.elements.title;
    const errorMessage = form.querySelector('.create-error');
    const submit = form.querySelector('button[type="submit"]');
    const projectLabel = element('label', 'create-project-label', 'Project');
    const projectSelect = element('project-picker', 'create-project');
    projectSelect.id = `${input.id}-project`;
    projectSelect.name = 'projectId';
    projectLabel.htmlFor = projectSelect.id;
    populateProjectSelect(projectSelect, null);
    form.querySelector('.create-controls').after(projectLabel, projectSelect);
    projectSelect.addEventListener('change', persistDropdownPreferences);
    submit.prepend(icon('plus'));
    input.addEventListener('input', () => {
        errorMessage.hidden = true;
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (refreshing || form.getAttribute('aria-busy') === 'true') return;
        const title = input.value;
        const status = form.closest('.column').dataset.status;
        const projectId = projectSelect.value || null;
        errorMessage.hidden = true;
        form.setAttribute('aria-busy', 'true');
        input.disabled = true;
        submit.disabled = true;
        projectSelect.disabled = true;
        pendingCreates++;
        updateRefresh();
        try {
            const created = await api('', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, status, projectId })
            });
            input.value = '';
            const ticket = normalizeTicket(await api(`/${created.id}`));
            placeTicket(ticket);
            if (ticket.projectId !== projectId) {
                throw new Error('The ticket was created, but its project assignment was not applied. Refresh the board before trying again.');
            }
            showFeedback(`Ticket created in ${status}.${matchesView(ticket) ? '' : ' It is outside the selected project view.'}`);
        } catch (error) {
            errorMessage.hidden = false;
            errorMessage.textContent = error.message;
        } finally {
            pendingCreates--;
            form.removeAttribute('aria-busy');
            input.disabled = false;
            submit.disabled = false;
            projectSelect.disabled = !projectCatalogReady;
            updateRefresh();
            if (document.activeElement === document.body || document.activeElement === input || document.activeElement === submit) input.focus();
        }
    });
});

refreshButton.addEventListener('click', loadTickets);
ticketSearch.addEventListener('input', event => { if (!event.isComposing) applyProjectFilter(); });
ticketSearch.addEventListener('compositionend', applyProjectFilter);
clearSearch.addEventListener('click', () => {
    ticketSearch.value = '';
    applyProjectFilter();
    ticketSearch.focus();
});
document.querySelector('#search-shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
ticketSearch.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
        event.preventDefault();
        const first = document.querySelector('.ticket:not([hidden]) .ticket-title');
        first?.focus();
        first?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } else if (event.key === 'Escape') {
        event.preventDefault();
        ticketSearch.value = '';
        applyProjectFilter();
    }
});
blockedFilter.addEventListener('click', () => {
    closeTicketMenus();
    blockedFilter.setAttribute('aria-pressed', String(blockedFilter.getAttribute('aria-pressed') !== 'true'));
    applyProjectFilter();
});
clearFilters.addEventListener('click', () => {
    ticketSearch.value = '';
    blockedFilter.setAttribute('aria-pressed', 'false');
    projectFilter.value = 'all';
    projectFilter.dispatchEvent(new Event('change'));
    ticketSearch.focus();
});
document.addEventListener('keydown', event => {
    const command = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey;
    const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey
        && !event.target.closest('input, textarea, project-picker, [contenteditable="true"]');
    if (!currentAccount || (!command && !slash) || event.isComposing || projectDialog.open
        || document.querySelector('#delete-dialog').open || ticketSearch.disabled) return;
    event.preventDefault();
    document.querySelectorAll('project-picker').forEach(picker => picker.close());
    closeTicketMenus();
    ticketSearch.focus();
    ticketSearch.select();
});
projectFilter.addEventListener('change', () => {
    closeTicketMenus();
    applyProjectFilter();
    document.querySelectorAll('.create-project').forEach(select => {
        select.value = ['all', 'unassigned'].includes(projectFilter.value) ? '' : projectFilter.value;
    });
    persistDropdownPreferences();
});

manageProjectsButton.addEventListener('click', () => {
    closeTicketMenus();
    projectFeedback.textContent = projectCatalogReady ? '' : 'Project management is unavailable. Close this window and refresh the board to retry.';
    projectFeedback.classList.toggle('error', !projectCatalogReady);
    updateProjectForm();
    projectDialog.showModal();
    if (projectCatalogReady) projectNameInput.focus();
});

document.querySelector('#close-projects').addEventListener('click', () => {
    if (!pendingProject) projectDialog.close();
});

projectDialog.addEventListener('cancel', event => {
    if (pendingProject) event.preventDefault();
});

managedProject.addEventListener('change', () => {
    projectFeedback.textContent = '';
    updateProjectForm();
    persistDropdownPreferences();
    projectNameInput.focus();
});

async function mutateProject(action, successMessage) {
    if (pendingProject || !projectCatalogReady) return;
    pendingProject = true;
    updateRefresh();
    projectForm.setAttribute('aria-busy', 'true');
    projectDialog.querySelectorAll('project-picker, button, input').forEach(control => { control.disabled = true; });
    projectFeedback.classList.remove('error');
    projectFeedback.textContent = 'Saving…';
    try {
        const project = await action();
        pendingProject = false;
        const refreshed = await loadTickets();
        if (projectCatalogReady && project?.id && savedProjects.has(String(project.id))) {
            managedProject.value = String(project.id);
            updateProjectForm();
            persistDropdownPreferences();
        }
        projectFeedback.textContent = refreshed ? successMessage : `${successMessage} Refresh failed. Refresh the board before making another change.`;
        projectFeedback.classList.toggle('error', !refreshed);
        if (projectCatalogReady) projectNameInput.focus();
    } catch (error) {
        projectFeedback.textContent = error.message;
        projectFeedback.classList.add('error');
    } finally {
        pendingProject = false;
        projectForm.removeAttribute('aria-busy');
        projectDialog.querySelectorAll('project-picker, button, input').forEach(control => { control.disabled = false; });
        if (!projectCatalogReady) {
            projectForm.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
            managedProject.disabled = true;
        }
        const project = savedProjects.get(managedProject.value);
        deleteProjectButton.disabled = pendingProject || !projectCatalogReady
            || Boolean(project && [...savedTickets.values()].some(ticket => String(ticket.projectId) === managedProject.value));
        updateRefresh();
    }
}

projectForm.addEventListener('submit', event => {
    event.preventDefault();
    const id = managedProject.value;
    const name = projectNameInput.value;
    mutateProject(async () => {
        return api(id ? `/${encodeURIComponent(id)}` : '', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        }, 'projects');
    }, id ? 'Project renamed.' : 'Project created.');
});

deleteProjectButton.addEventListener('click', async () => {
    const id = managedProject.value;
    const project = savedProjects.get(id);
    if (!project || pendingProject || !projectCatalogReady || deleteProjectButton.disabled) return;
    if (!await confirmDeletion(project.name, 'project')) return;
    mutateProject(async () => {
        await api(`/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'projects');
        managedProject.value = '';
    }, 'Project deleted.');
});

projectFilter.setOptions([{ value: 'all', textContent: 'All projects' }, { value: 'unassigned', textContent: 'Unassigned' }]);
managedProject.setOptions([{ value: '', textContent: 'New project' }]);

function showAuthMessage(message, error = false) {
    authFeedback.textContent = message;
    authFeedback.classList.toggle('error', error);
}

function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === 'register';
    document.querySelector('#auth-title').textContent = registering ? 'Create your account' : 'Log in to Workboard';
    document.querySelector('#auth-description').textContent = registering
        ? 'Start a private board for your tickets and projects.' : 'Your tickets and projects, in one place.';
    authSubmit.textContent = registering ? 'Create account' : 'Log in';
    authSwitch.textContent = registering ? 'Already have an account? Log in' : 'Create an account';
    authPassword.autocomplete = registering ? 'new-password' : 'current-password';
    authPassword.minLength = registering ? 15 : 1;
    document.querySelector('#auth-password-help').hidden = !registering;
    authPassword.value = '';
}

function showSignedOut(message = '', error = false) {
    sessionGeneration++;
    currentAccount = null;
    dropdownStorageKey = null;
    dropdownPreferences = {};
    dropdownsRestored = false;
    workspace.hidden = true;
    headerActions.hidden = true;
    document.querySelector('.skip-link').hidden = true;
    document.querySelector('#account-email').textContent = '';
    closeTicketMenus();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    savedTickets.clear();
    savedProjects.clear();
    document.querySelectorAll('.cards').forEach(cards => cards.replaceChildren());
    authPanel.hidden = false;
    authForm.hidden = false;
    retrySession.hidden = true;
    setAuthMode('login');
    showAuthMessage(message, error);
    document.querySelector('#auth-email').focus();
}

async function restoreSession() {
    retrySession.hidden = true;
    authForm.hidden = true;
    showAuthMessage('Checking your session…');
    try {
        const user = await api('/me', {}, 'auth');
        if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') {
            throw new Error('The server returned an invalid account response.');
        }
        currentAccount = user;
        dropdownStorageKey = `workboard.dropdowns.v1.${user.id}`;
        dropdownPreferences = readDropdownPreferences();
        document.querySelector('#account-email').textContent = user.email;
        authPanel.hidden = true;
        workspace.hidden = false;
        headerActions.hidden = false;
        document.querySelector('.skip-link').hidden = false;
        await loadTickets();
    } catch (error) {
        if (error.status === 401) {
            showSignedOut();
        } else {
            showAuthMessage(error.message, true);
            retrySession.hidden = false;
        }
    }
}

authSwitch.addEventListener('click', () => {
    if (authBusy) return;
    setAuthMode(authMode === 'login' ? 'register' : 'login');
    showAuthMessage('');
    document.querySelector('#auth-email').focus();
});

retrySession.addEventListener('click', restoreSession);

authForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (authBusy) return;
    authBusy = true;
    authForm.setAttribute('aria-busy', 'true');
    authForm.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
    const email = document.querySelector('#auth-email').value;
    const password = authPassword.value;
    let registered = false;
    const submit = path => api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    }, 'auth');
    showAuthMessage(authMode === 'register' ? 'Creating your account…' : 'Logging in…');
    try {
        if (authMode === 'register') {
            await submit('/register');
            registered = true;
        }
        await submit('/login');
        authPassword.value = '';
        window.location.reload();
    } catch (error) {
        if (registered) setAuthMode('login');
        showAuthMessage(registered ? `Your account was created. Log in to continue. ${error.message}` : error.message, true);
        authPassword.value = '';
    } finally {
        authBusy = false;
        authForm.removeAttribute('aria-busy');
        authForm.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
    }
});

logoutButton.addEventListener('click', async () => {
    if (logoutButton.disabled) return;
    authBusy = true;
    updateRefresh();
    try {
        await api('/logout', { method: 'POST' }, 'auth');
        showSignedOut();
        window.location.reload();
    } catch (error) {
        if (error.status === 401) {
            showSignedOut('Your session has ended. Log in to continue.');
        } else {
            showFeedback(`Could not log out. ${error.message}`, true);
        }
    } finally {
        authBusy = false;
        updateRefresh();
    }
});

restoreSession();
