import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PanelSearchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
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

        // Providers group
        const providersGroup = new Adw.PreferencesGroup({
            title: 'Search Providers',
            description: 'Enable and configure additional result sources'
        });
        page.add(providersGroup);

        const fileSearchRow = new Adw.SwitchRow({
            title: 'Local File Search',
            subtitle: 'Show file suggestions by scanning the local filesystem'
        });
        settings.bind(
            'enable-file-search',
            fileSearchRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(fileSearchRow);

        const fileResultsRow = new Adw.SpinRow({
            title: 'File Result Limit',
            subtitle: 'Maximum local file suggestions (1-15)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 15,
                step_increment: 1
            })
        });
        settings.bind(
            'file-search-max-results',
            fileResultsRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(fileResultsRow);
        settings.bind(
            'enable-file-search',
            fileResultsRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const fileMinCharsRow = new Adw.SpinRow({
            title: 'File Query Min Length',
            subtitle: 'Minimum characters before file lookup starts (1-20)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 20,
                step_increment: 1
            })
        });
        settings.bind(
            'file-search-min-query-length',
            fileMinCharsRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(fileMinCharsRow);
        settings.bind(
            'enable-file-search',
            fileMinCharsRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );


        const fileMaxDepthRow = new Adw.SpinRow({
            title: 'File Scan Depth',
            subtitle: 'Maximum folder depth scanned per query (1-6)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 6,
                step_increment: 1
            })
        });
        settings.bind(
            'file-search-max-depth',
            fileMaxDepthRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(fileMaxDepthRow);
        settings.bind(
            'enable-file-search',
            fileMaxDepthRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const fileMaxDirectoriesRow = new Adw.SpinRow({
            title: 'Maximum Folders to Search',
            subtitle: 'Maximum directories scanned per query (10-500)',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 500,
                step_increment: 10
            })
        });
        settings.bind(
            'file-search-max-directories',
            fileMaxDirectoriesRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(fileMaxDirectoriesRow);
        settings.bind(
            'enable-file-search',
            fileMaxDirectoriesRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const fileRootPathHelpRow = new Adw.ActionRow({
            title: 'File Root Path Format',
            subtitle: 'Use an absolute path or a path relative to home. Leave blank to search your home directory.'
        });
        providersGroup.add(fileRootPathHelpRow);
        settings.bind(
            'enable-file-search',
            fileRootPathHelpRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const fileRootPathRow = new Adw.EntryRow({
            title: 'File Search Root',
            show_apply_button: true,
        });
        settings.bind(
            'file-search-root-path',
            fileRootPathRow,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(fileRootPathRow);
        settings.bind(
            'enable-file-search',
            fileRootPathRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const weatherSearchRow = new Adw.SwitchRow({
            title: 'Weather Search',
            subtitle: 'Enable location weather queries (e.g., "weather Boston")'
        });
        settings.bind(
            'enable-weather-search',
            weatherSearchRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(weatherSearchRow);

        const weatherUnitsRow = new Adw.ComboRow({
            title: 'Weather Units',
            subtitle: 'Temperature unit for weather results',
            model: new Gtk.StringList({
                strings: ['Fahrenheit', 'Celsius']
            })
        });
        const weatherUnitMap = ['fahrenheit', 'celsius'];
        const currentWeatherUnits = settings.get_string('weather-units');
        const selectedWeatherUnits = weatherUnitMap.indexOf(currentWeatherUnits);
        weatherUnitsRow.set_selected(selectedWeatherUnits >= 0 ? selectedWeatherUnits : 0);
        weatherUnitsRow.connect('notify::selected', (widget) => {
            const selected = weatherUnitMap[widget.selected] ?? 'fahrenheit';
            settings.set_string('weather-units', selected);
        });
        providersGroup.add(weatherUnitsRow);
        settings.bind(
            'enable-weather-search',
            weatherUnitsRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const packageSearchRow = new Adw.SwitchRow({
            title: 'Package Search',
            subtitle: 'Show software package suggestions from GNOME Software'
        });
        settings.bind(
            'enable-package-search',
            packageSearchRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(packageSearchRow);

        const packageResultsRow = new Adw.SpinRow({
            title: 'Package Result Limit',
            subtitle: 'Maximum package suggestions (1-10)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1
            })
        });
        settings.bind(
            'package-search-max-results',
            packageResultsRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(packageResultsRow);
        settings.bind(
            'enable-package-search',
            packageResultsRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const debounceRow = new Adw.SpinRow({
            title: 'Search Delay (ms)',
            subtitle: 'Delay before search runs after typing (50-500 ms)',
            adjustment: new Gtk.Adjustment({
                lower: 50,
                upper: 500,
                step_increment: 10
            })
        });
        settings.bind(
            'search-debounce-ms',
            debounceRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        providersGroup.add(debounceRow);

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
                upper: 100,
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
            subtitle: 'Apps, Settings, Local files, Weather (e.g., "weather Boston"), Calculator, Unit conversion, Predictions, Web search'
        });
        infoGroup.add(usageRow);
        
        const keyboardRow = new Adw.ActionRow({
            title: 'Keyboard Navigation',
            subtitle: 'Arrow keys to navigate, Enter to select, Escape to close'
        });
        infoGroup.add(keyboardRow);
    }
}
