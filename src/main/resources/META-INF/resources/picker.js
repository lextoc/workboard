let pickerSequence = 0;

class ProjectPicker extends HTMLElement {
    constructor() {
        super();
        this.items = [];
        this.currentValue = '';
        this.activeIndex = 0;
        this.typeahead = '';
        this.lastTyped = 0;
        this.reposition = () => this.positionList();
    }

    connectedCallback() {
        if (this.trigger) return;
        const key = `picker-${++pickerSequence}`;
        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'picker-trigger';
        this.trigger.setAttribute('role', 'combobox');
        this.trigger.setAttribute('aria-haspopup', 'listbox');
        this.trigger.setAttribute('aria-expanded', 'false');
        this.trigger.setAttribute('aria-controls', `${key}-list`);
        this.caption = document.createElement('span');
        this.caption.className = 'picker-caption';
        const chevron = document.createElement('span');
        chevron.className = 'picker-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        this.trigger.append(this.caption, chevron);
        this.list = document.createElement('div');
        this.list.id = `${key}-list`;
        this.list.className = 'picker-list';
        this.list.setAttribute('role', 'listbox');
        this.list.setAttribute('popover', 'auto');
        this.append(this.trigger, this.list);
        this.trigger.addEventListener('click', () => this.isOpen ? this.close() : this.open());
        this.trigger.addEventListener('keydown', event => this.onKey(event));
        this.list.addEventListener('pointerdown', event => event.preventDefault());
        this.list.addEventListener('click', event => {
            const option = event.target.closest('[data-option-index]');
            if (option) this.choose(Number(option.dataset.optionIndex));
        });
        this.list.addEventListener('toggle', () => {
            this.trigger.setAttribute('aria-expanded', String(this.isOpen));
            if (!this.isOpen) {
                this.trigger.removeAttribute('aria-activedescendant');
                window.removeEventListener('resize', this.reposition);
                window.removeEventListener('scroll', this.reposition, true);
            }
        });
        this.render();
    }

    disconnectedCallback() {
        this.close();
        window.removeEventListener('resize', this.reposition);
        window.removeEventListener('scroll', this.reposition, true);
    }

    get value() { return this.currentValue; }
    set value(value) {
        this.currentValue = this.items.some(item => item.value === String(value)) ? String(value) : '';
        this.render();
    }
    get options() { return this.items; }
    get selectedOptions() { return this.items.filter(item => item.value === this.value); }
    get selectedIndex() { return this.items.findIndex(item => item.value === this.value); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) {
        this.toggleAttribute('disabled', Boolean(value));
        if (this.trigger) this.trigger.disabled = Boolean(value);
        if (value) this.close();
    }
    get isOpen() { return this.list?.matches(':popover-open') ?? false; }

    setOptions(items) {
        this.items = items.map(item => ({ value: String(item.value), textContent: item.textContent }));
        if (!this.items.some(item => item.value === this.value)) this.currentValue = this.items[0]?.value ?? '';
        this.render();
    }

    focus(options) { this.trigger?.focus(options); }

    render() {
        if (!this.trigger) return;
        const label = this.id ? document.querySelector(`label[for="${CSS.escape(this.id)}"]`)?.textContent : '';
        const caption = this.selectedOptions[0]?.textContent ?? 'Choose a project';
        this.caption.textContent = caption;
        this.trigger.setAttribute('aria-label', `${label || 'Project'}: ${caption}`);
        this.list.setAttribute('aria-label', label || 'Project');
        this.trigger.title = caption;
        this.trigger.disabled = this.disabled;
        this.list.replaceChildren(...this.items.map((item, index) => {
            const option = document.createElement('div');
            option.id = `${this.list.id}-${index}`;
            option.className = 'picker-option';
            option.dataset.optionIndex = index;
            option.dataset.value = item.value;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(item.value === this.value));
            option.textContent = item.textContent;
            return option;
        }));
        if (this.isOpen) {
            this.positionList();
            this.setActive(Math.max(0, this.selectedIndex));
        }
    }

    open() {
        if (this.disabled || !this.items.length) return;
        this.list.showPopover();
        this.trigger.setAttribute('aria-expanded', 'true');
        this.positionList();
        this.setActive(Math.max(0, this.selectedIndex));
        window.addEventListener('resize', this.reposition);
        window.addEventListener('scroll', this.reposition, true);
    }

    close() {
        if (this.isOpen) this.list.hidePopover();
        this.trigger?.setAttribute('aria-expanded', 'false');
        this.trigger?.removeAttribute('aria-activedescendant');
    }

    positionList() {
        if (!this.isOpen) return;
        const rect = this.trigger.getBoundingClientRect();
        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        const width = viewport?.width ?? window.innerWidth;
        const offsetTop = viewport?.offsetTop ?? 0;
        const offsetLeft = viewport?.offsetLeft ?? 0;
        const below = height + offsetTop - rect.bottom - 12;
        const above = rect.top - offsetTop - 12;
        const flip = below < 180 && above > below;
        const listWidth = Math.min(Math.max(rect.width, 220), width - 24);
        this.list.style.width = `${listWidth}px`;
        this.list.style.maxHeight = `${Math.max(44, Math.min(280, flip ? above : below))}px`;
        this.list.style.left = `${Math.max(offsetLeft + 12, Math.min(rect.left, width + offsetLeft - listWidth - 12))}px`;
        this.list.style.top = `${flip ? rect.top - this.list.getBoundingClientRect().height - 6 : rect.bottom + 6}px`;
    }

    setActive(index) {
        this.activeIndex = Math.max(0, Math.min(index, this.items.length - 1));
        [...this.list.children].forEach((option, position) => option.classList.toggle('active', position === this.activeIndex));
        const active = this.list.children[this.activeIndex];
        if (active) {
            this.trigger.setAttribute('aria-activedescendant', active.id);
            active.scrollIntoView({ block: 'nearest' });
        }
    }

    choose(index) {
        const item = this.items[index];
        if (!item || this.disabled) return;
        const changed = item.value !== this.value;
        this.close();
        this.value = item.value;
        this.focus();
        if (changed) this.dispatchEvent(new Event('change', { bubbles: true }));
    }

    onKey(event) {
        if (event.isComposing) return;
        const key = event.key;
        if (key === 'Tab') { this.close(); return; }
        if (key === 'Escape' && this.isOpen) {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            const wasOpen = this.isOpen;
            if (!wasOpen) this.open();
            if (key === 'Home') this.setActive(0);
            else if (key === 'End') this.setActive(this.items.length - 1);
            else if (wasOpen) this.setActive(this.activeIndex + (key === 'ArrowDown' ? 1 : -1));
        } else if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            if (this.isOpen) this.choose(this.activeIndex);
            else this.open();
        } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            const now = Date.now();
            this.typeahead = (now - this.lastTyped > 700 ? '' : this.typeahead) + key.toLocaleLowerCase();
            this.lastTyped = now;
            if (!this.isOpen) this.open();
            const match = this.items.findIndex(item => item.textContent.toLocaleLowerCase().startsWith(this.typeahead));
            if (match >= 0) this.setActive(match);
        }
    }
}

customElements.define('project-picker', ProjectPicker);

document.addEventListener('click', event => {
    const label = event.target.closest('label[for]');
    const picker = label && document.getElementById(label.htmlFor);
    if (picker instanceof ProjectPicker) picker.focus();
});
