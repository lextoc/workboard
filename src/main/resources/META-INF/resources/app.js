const feedback = document.querySelector('#feedback');
const refreshButton = document.querySelector('#refresh');
const statuses = ['TODO', 'DOING', 'DONE'];
const savedTickets = new Map();
const pendingTickets = new Set();
const editingTickets = new Set();
let draggedTicketId = null;
let refreshing = false;
let pendingCreates = 0;

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
        grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
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
}

function apiErrorMessage(response, data, body) {
    const text = value => typeof value === 'string' ? value.trim() : '';
    const labels = {
        title: 'Title',
        status: 'Status',
        blocked: 'Blocked',
        blockedNote: 'Blocking reason'
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
                ? 'This ticket could not be found. Refresh the board and try again.'
                : 'The server rejected the request without an explanation.';
    return `HTTP ${response.status}: ${(detail || plainText || fallback).slice(0, 1500)}`;
}

async function api(path = '', options = {}) {
    let response;
    let body;
    try {
        response = await fetch(`/api/tickets${path}`, {
            ...options,
            headers: { 'Accept': 'application/json', ...options.headers }
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
    if (!response.ok) {
        throw new Error(apiErrorMessage(response, data, body));
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
    refreshButton.disabled = refreshing || pendingTickets.size > 0 || pendingCreates > 0;
}

function updateColumns() {
    const emptyMessages = {
        TODO: 'Ready for your next task',
        DOING: 'Nothing in progress',
        DONE: 'No completed tasks'
    };
    for (const status of statuses) {
        const column = document.querySelector(`[data-status="${status}"]`);
        const cards = column.querySelector('.cards');
        const count = cards.querySelectorAll('.ticket').length;
        column.querySelector('.count').textContent = count;
        cards.querySelector('.empty')?.remove();
        if (!count) cards.append(element('p', 'empty', emptyMessages[status]));
    }
}

function placeTicket(ticket, focusTarget) {
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
    updateColumns();
    if (focusTarget) card.querySelector(focusTarget)?.focus();
}

async function runCard(id, action, focusTarget = '.ticket-title') {
    id = String(id);
    if (refreshing || pendingTickets.has(id)) return;
    const card = cardFor(id);
    const focused = document.activeElement;
    const controls = [...card.querySelectorAll('button, input, textarea')];
    const disabled = controls.map(control => control.disabled);
    pendingTickets.add(id);
    updateRefresh();
    clearDrag();
    card.setAttribute('aria-busy', 'true');
    card.draggable = false;
    controls.forEach(control => { control.disabled = true; });
    const message = card.querySelector('.ticket-feedback');
    message.classList.remove('error', 'sr-only');
    message.textContent = 'Saving…';
    let saved = false;
    try {
        await action();
        saved = true;
    } catch (error) {
        message.textContent = error.message;
        message.classList.add('error');
    } finally {
        pendingTickets.delete(id);
        updateRefresh();
        if (card.isConnected) {
            card.removeAttribute('aria-busy');
            card.draggable = !editingTickets.has(id);
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
        }
        if (document.activeElement === document.body || card.contains(document.activeElement)) {
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
    const ticket = await api(`/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: current.title,
            status: current.status,
            blocked: current.blocked,
            blockedNote: current.blockedNote,
            ...changes
        })
    });
    editingTickets.delete(String(id));
    placeTicket(ticket);
    const message = cardFor(id).querySelector('.ticket-feedback');
    message.classList.add('sr-only');
    message.textContent = 'Saved';
}

function clearDrag() {
    draggedTicketId = null;
    document.querySelectorAll('.drop-target, .dragging').forEach(node => {
        node.classList.remove('drop-target', 'dragging');
    });
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
    card.classList.add('editing');
    card.draggable = false;
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

function ticketCard(ticket) {
    const id = String(ticket.id);
    const card = element('article', `ticket${ticket.blocked ? ' blocked' : ''}`);
    card.dataset.ticketId = id;
    card.draggable = true;
    let suppressClick = false;
    card.addEventListener('pointerdown', event => {
        card.draggable = !refreshing && !pendingTickets.has(id) && !editingTickets.has(id)
            && (!event.target.closest('.ticket-menu') || !!event.target.closest('.drag-handle'));
    });
    card.addEventListener('click', event => {
        if (suppressClick || event.target.closest('.ticket-menu, .inline-editor')) return;
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
        if (!card.isConnected || refreshing || pendingTickets.has(id) || editingTickets.has(id) || draggedTicketId) return;
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
            panel.querySelector('button')?.focus();
        }
    });
    const handle = actionButton('Drag to move', 'grip', 'quiet drag-handle', `Move ticket ${id}. Drag or use Left and Right arrow keys.`);
    handle.draggable = true;
    handle.title = 'Drag to move · ← / → when focused';
    handle.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
    handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const destination = statuses[statuses.indexOf(ticket.status) + direction];
        if (destination) moveTicket(id, destination);
    });
    card.addEventListener('dragstart', event => {
        if (refreshing || pendingTickets.has(id) || editingTickets.has(id) || !card.draggable) {
            event.preventDefault();
            return;
        }
        suppressClick = true;
        closeTicketMenus();
        draggedTicketId = id;
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setDragImage(card, card.offsetWidth / 2, 20);
        card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
        clearDrag();
        setTimeout(() => { suppressClick = false; }, 0);
    });
    const remove = actionButton('Delete ticket', 'trash', 'quiet danger', `Delete ticket ${id}: ${ticket.title}`);
    remove.title = 'Delete ticket';
    remove.addEventListener('click', () => {
        if (pendingTickets.has(id) || editingTickets.has(id) || refreshing
            || !window.confirm(`Delete “${ticket.title}” (#${id.slice(0, 8)})?`)) return;
        runCard(id, async () => {
            await api(`/${id}`, { method: 'DELETE' });
            savedTickets.delete(id);
            card.remove();
            updateColumns();
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
    const statusIndex = statuses.indexOf(ticket.status);
    for (const direction of [-1, 1]) {
        const destination = statuses[statusIndex + direction];
        if (!destination) continue;
        const labels = { TODO: 'Move to To do', DOING: direction > 0 ? 'Start ticket' : 'Reopen ticket', DONE: 'Complete ticket' };
        const move = actionButton(labels[destination], direction < 0 ? 'left' : 'right', 'quiet move-action',
            `${labels[destination]}: move ticket ${id} to ${destination}`);
        move.addEventListener('click', () => moveTicket(id, destination));
        panel.append(move);
    }
    panel.append(handle, remove);
    menu.append(trigger, panel);
    header.append(heading, menu);
    const message = element('p', 'ticket-feedback');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    card.append(header, blocker, message);
    return card;
}

async function loadTickets() {
    if (refreshing || pendingTickets.size || pendingCreates) return;
    const focused = document.activeElement;
    refreshing = true;
    updateRefresh();
    try {
        const tickets = await api();
        if (!Array.isArray(tickets)) throw new Error('Expected a ticket list from the server.');
        const received = new Set(tickets.map(ticket => String(ticket.id)));
        for (const id of savedTickets.keys()) {
            if (!received.has(id) && !editingTickets.has(id)) {
                savedTickets.delete(id);
                cardFor(id)?.remove();
            }
        }
        for (const ticket of tickets) {
            if (editingTickets.has(String(ticket.id))) savedTickets.set(String(ticket.id), ticket);
            else placeTicket(ticket);
        }
        updateColumns();
        showFeedback('Tickets refreshed.');
    } catch (error) {
        showFeedback(error.message, true);
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

document.querySelectorAll('.column').forEach(column => {
    column.addEventListener('dragover', event => {
        if (!canMove(draggedTicketId, column.dataset.status)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        column.classList.add('drop-target');
    });
    column.addEventListener('dragleave', event => {
        if (!column.contains(event.relatedTarget)) column.classList.remove('drop-target');
    });
    column.addEventListener('drop', event => {
        const id = draggedTicketId;
        if (!id) return;
        event.preventDefault();
        const transferredId = event.dataTransfer.getData('text/plain');
        clearDrag();
        if (transferredId === id) moveTicket(id, column.dataset.status);
    });
});

document.querySelectorAll('.create-form').forEach(form => {
    const input = form.elements.title;
    const errorMessage = form.querySelector('.create-error');
    const submit = form.querySelector('button[type="submit"]');
    submit.prepend(icon('plus'));
    input.addEventListener('input', () => {
        errorMessage.hidden = true;
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (refreshing || form.getAttribute('aria-busy') === 'true') return;
        const title = input.value;
        const status = form.closest('.column').dataset.status;
        errorMessage.hidden = true;
        form.setAttribute('aria-busy', 'true');
        input.disabled = true;
        submit.disabled = true;
        pendingCreates++;
        updateRefresh();
        try {
            const ticket = await api('', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, status })
            });
            placeTicket(ticket);
            input.value = '';
            showFeedback(`Ticket created in ${status}.`);
        } catch (error) {
            errorMessage.hidden = false;
            errorMessage.textContent = error.message;
        } finally {
            pendingCreates--;
            form.removeAttribute('aria-busy');
            input.disabled = false;
            submit.disabled = false;
            updateRefresh();
            if (document.activeElement === document.body || document.activeElement === input || document.activeElement === submit) input.focus();
        }
    });
});

refreshButton.addEventListener('click', loadTickets);
loadTickets();
