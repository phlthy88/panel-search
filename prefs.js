import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PanelSearchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        if (this._clearTimeoutId) {
            GLib.source_remove(this._clearTimeoutId);
            this._clearTimeoutId = null;
        }
        this._clearTimeoutId = null;

        window.connect('close-request', () => {
            if (this._clearTimeoutId) {
                GLib.source_remove(this._clearTimeoutId);
                this._clearTimeoutId = null;
            }
            return false;
        });
        
        const page = new Adw.PreferencesPage();
        window.add(page);
        
        // General group
        const generalGroup = new Adw.PreferencesGroup({
            title: 'General Settings',
            description: 'Configure search widget behavior'
        });
        page.add(generalGroup);
        
        // Search engine selection
        const engineRow = new Adw.ComboRow({
            title: 'Search Engine',
            subtitle: 'Default web search engine',
            model: new Gtk.StringList({
                strings: ['Google', 'DuckDuckGo', 'Bing']
            })
        });
        
        const engineMap = ['google', 'duckduckgo', 'bing'];
        const currentEngine = settings.get_string('search-engine');
        const selectedEngine = engineMap.indexOf(currentEngine);
        engineRow.set_selected(selectedEngine >= 0 ? selectedEngine : 0);
        
        engineRow.connect('notify::selected', (widget) => {
            const selected = engineMap[widget.selected] ?? 'google';
            settings.set_string('search-engine', selected);
        });
        
        generalGroup.add(engineRow);
        
        // Max predictions setting
        const predictionsRow = new Adw.SpinRow({
            title: 'Maximum Predictions',
            subtitle: 'Number of suggestions to show (0 to disable)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 5,
                step_increment: 1
            })
        });
        
        settings.bind(
            'max-predictions',
            predictionsRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        
        generalGroup.add(predictionsRow);
        
        // Clear history button
        const clearHistoryRow = new Adw.ActionRow({
            title: 'Clear Search History',
            subtitle: 'Remove all learned predictions'
        });
        
        const clearButton = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });
        
        clearButton.connect('clicked', () => {
            settings.set_string('usage-history', '{}');
            clearButton.set_sensitive(false);

            if (this._clearTimeoutId) {
                GLib.source_remove(this._clearTimeoutId);
                this._clearTimeoutId = null;
            }

            this._clearTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                clearButton.set_sensitive(true);
                this._clearTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        });
        
        clearHistoryRow.add_suffix(clearButton);
        generalGroup.add(clearHistoryRow);
        
        // Panel position group
        const positionGroup = new Adw.PreferencesGroup({
            title: 'Panel Position',
            description: 'Configure widget placement in top panel'
        });
        page.add(positionGroup);
        
        // Panel box selection
        const boxRow = new Adw.ComboRow({
            title: 'Panel Box',
            subtitle: 'Which section of the panel',
            model: new Gtk.StringList({
                strings: ['Left', 'Center', 'Right']
            })
        });
        
        const boxMap = ['left', 'center', 'right'];
        const currentBox = settings.get_string('panel-box');
        const selectedBox = boxMap.indexOf(currentBox);
        boxRow.set_selected(selectedBox >= 0 ? selectedBox : 0);
        
        boxRow.connect('notify::selected', (widget) => {
            const selected = boxMap[widget.selected] ?? 'left';
            settings.set_string('panel-box', selected);
        });
        
        positionGroup.add(boxRow);
        
        // Position index
        const positionRow = new Adw.SpinRow({
            title: 'Position Index',
            subtitle: 'Order within the selected box (0 = first)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1
            })
        });
        
        settings.bind(
            'panel-position',
            positionRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        
        positionGroup.add(positionRow);
        
        // Info group
        const infoGroup = new Adw.PreferencesGroup({
            title: 'Usage',
            description: 'How to use Panel Search'
        });
        page.add(infoGroup);
        
        const usageRow = new Adw.ActionRow({
            title: 'Search Features',
            subtitle: 'Apps, Settings, Calculator (e.g., "2+2"), Unit conversion (e.g., "10 km to mi"), Predictions, Web search'
        });
        infoGroup.add(usageRow);
        
        const keyboardRow = new Adw.ActionRow({
            title: 'Keyboard Navigation',
            subtitle: 'Arrow keys to navigate, Enter to select, Escape to close'
        });
        infoGroup.add(keyboardRow);
    }
}
