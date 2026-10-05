"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Info, Palette, Plus, Trash2, RotateCcw } from "lucide-react";
import { defaultDisplaySettings, displaySettingsKey, parseDisplaySettings, type DisplaySettings } from "@/lib/display-settings";

import { coordinatedThemeColors, interfaceTheme, interfacePresets, themeColorFields, type CustomTheme } from "@/lib/interface-theme";
import { groupTheme } from "@/lib/group-theme";
import { ItemTooltip } from "./item-tooltip";

const SettingsContext = createContext({
  settings: defaultDisplaySettings,
  update: (_patch: Partial<DisplaySettings>) => {},
});
export const useDisplaySettings = () => useContext(SettingsContext);

export function OverviewZoomOverride({ value, children }: { value: number; children: ReactNode }) {
  const parent = useDisplaySettings();
  return <SettingsContext.Provider value={{ ...parent, settings: { ...parent.settings, overviewZoom: value } }}>{children}</SettingsContext.Provider>;
}

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultDisplaySettings);
  useEffect(() => {
    try { setSettings(parseDisplaySettings(JSON.parse(sessionStorage.getItem(displaySettingsKey) ?? "null"))); } catch {}
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "blue") return;
    const theme = interfaceTheme(settings);
    const values: Record<string, string> = {
      "--background": theme.sidebar, "--panel": theme.body, "--line": theme.sidebarBorder,
      "--accent": theme.accent, "--panel-gradient": theme.sidebarHeader,
      "--header-gradient": theme.sidebarHeader, "--action-gradient": theme.sidebarHeader,
      "--interface-sidebar": theme.sidebarHeader, "--interface-body": theme.sidebar,
      "--interface-hover": theme.hover, "--interface-border": theme.border,
      "--interface-selected": theme.color + "33",
    };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, root.style.getPropertyValue(key)]));
    root.dataset.interfaceTheme = settings.theme;
    for (const [key, value] of Object.entries(values)) root.style.setProperty(key, value);
    return () => {
      delete root.dataset.interfaceTheme;
      for (const [key, value] of Object.entries(previous)) value ? root.style.setProperty(key, value) : root.style.removeProperty(key);
    };
  }, [settings.theme, settings.customThemes]);
  const update = (patch: Partial<DisplaySettings>) => {
    const next = parseDisplaySettings({ ...settings, ...patch });
    setSettings(next);
    try { sessionStorage.setItem(displaySettingsKey, JSON.stringify(next)); } catch {}
  };
  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}


function SettingsHelp({ label, text }: { label: string; text: string }) {
  return <button type="button" className="settings-help" aria-label={"About " + label}>
    <Info size={13} aria-hidden="true" />
    <ItemTooltip compact followPointer={false}><span className="settings-help-text">{text}</span></ItemTooltip>
  </button>;
}

function ThemeColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return <div className="settings-theme-color-row"><span>{label[0].toUpperCase() + label.slice(1)}</span>
    <input type="text" className="settings-theme-hex" aria-label={label + " hex code"} value={hex} maxLength={7} spellCheck={false}
      onChange={event => { const next = event.target.value; setHex(next); if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase()); }}
      onBlur={() => setHex(value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    <input type="color" aria-label={label + " color"} value={value} onChange={event => onChange(event.target.value)} />
  </div>;
}

export function DisplaySettingsPanel() {
  const [themeOpen, setThemeOpen] = useState(false);
  const themeSelectorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!themeOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !themeSelectorRef.current?.contains(event.target)) {
        setThemeOpen(false);
        setThemeDraft(null);
        editedColors.current.clear();
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [themeOpen]);
  const [themeDraft, setThemeDraft] = useState<CustomTheme | null>(null);
  const editedColors = useRef(new Set<typeof themeColorFields[number]>());
  const changeDraftColor = (key: typeof themeColorFields[number], value: string) => {
    if (themeDraft?.[key].toLowerCase() === value.toLowerCase()) return;
    editedColors.current.add(key);
    const coordinate = editedColors.current.size === 1;
    setThemeDraft(current => current ? coordinate ? coordinatedThemeColors(current, key, value) : { ...current, [key]: value } : current);
  };
  const { settings, update } = useDisplaySettings();
  const itemAnimation = settings.animatedArrows && settings.animatedItemImages && !settings.disableArrows;
  type SwitchKey = { [K in keyof DisplaySettings]: DisplaySettings[K] extends boolean ? K : never }[keyof DisplaySettings];
  const toggle = (key: SwitchKey, label: string, help: string) => <div className="settings-option" key={key}>
    <label className="settings-switch-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={key === "overviewLineItems" && itemAnimation ? false : settings[key]}
        disabled={(key === "animatedArrows" && settings.disableArrows) || (key === "animatedItemImages" && (!settings.animatedArrows || settings.disableArrows)) || (key === "overviewLineItems" && itemAnimation)}
        onChange={event => update({ [key]: event.target.checked })} />
    </label>
    <SettingsHelp label={label} text={help} />
  </div>;
  const range = (key: "overviewZoom" | "guiScale" | "lineThickness" | "animatedItemSize" | "animatedItemSpacing", label: string, help: string, min: number, max: number, step: number, percentage = false) => {
    const value = percentage ? Math.round(settings[key] * 100) : settings[key];
    return <div className="settings-option">
      <label className="settings-range">
        <span>{label}<output>{value}{percentage ? "%" : ""}</output></span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={event => update({ [key]: Number(event.target.value) / (percentage ? 100 : 1) })} />
      </label>
      <SettingsHelp label={label} text={help} />
    </div>;
  };
  return <section className="display-settings" aria-label="Display settings">
    <h2>Settings</h2>
    <section className="settings-section" aria-labelledby="settings-view-heading">
      <h3 id="settings-view-heading">View &amp; interface</h3>
      <div ref={themeSelectorRef}>
      <div className="settings-option">
        <div className="settings-theme-row"><Palette size={13} aria-hidden="true" /><span>Theme</span>
          <button type="button" className="group-theme-swatch" aria-label={"Choose interface theme: " + interfaceTheme(settings).name} aria-expanded={themeOpen} onClick={() => setThemeOpen(value => !value)} style={{ background: interfaceTheme(settings).color }} />
        </div>
        <SettingsHelp label="Theme" text="Changes the interface, default diagram group colors, and Grouping tab. Individually chosen group colors are preserved. Default restores the original blue theme." />
      </div>
      {themeOpen && <div className="group-theme-palette settings-theme-palette" role="group" aria-label="Interface themes">
        <div className="group-theme-default-row"><button type="button" className="group-theme-default-swatch" title="Default" aria-label="Default blue theme" aria-pressed={settings.theme === "blue"} style={{ background: groupTheme("blue").color }} onClick={() => { update({ theme: "blue" }); setThemeOpen(false); }} /><span>Default</span></div>
        {settings.customThemes.map(theme => <div className="settings-custom-theme-row" key={theme.id}>
          <button type="button" className="settings-custom-theme-select" aria-pressed={settings.theme === theme.id} onClick={() => { update({ theme: theme.id }); setThemeOpen(false); }}>
            <span className="settings-custom-theme-swatch" style={{ background: `linear-gradient(135deg, ${theme.header} 50%, ${theme.accent} 50%)` }} /><span>{theme.name}</span>
          </button>
          <button type="button" className="settings-custom-theme-delete" title={"Delete " + theme.name} aria-label={"Delete theme " + theme.name} onClick={() => update({ customThemes: settings.customThemes.filter(value => value.id !== theme.id), ...(settings.theme === theme.id ? { theme: "blue" } : {}) })}><Trash2 size={13} /></button>
        </div>)}
        <button type="button" className="settings-add-theme" onClick={() => {
          editedColors.current.clear();
          const current = interfaceTheme(settings);
          setThemeDraft({ id: `custom:${crypto.randomUUID()}`, name: "My theme", background: current.sidebar, panel: current.body, header: current.header, border: current.border, accent: current.accent });
        }}><Plus size={13} /> Add theme</button>
        {themeDraft && <div className="settings-theme-editor">
          <label>Name<input value={themeDraft.name} maxLength={60} onChange={event => setThemeDraft({ ...themeDraft, name: event.target.value })} /></label>
          {[...themeColorFields].reverse().map(key => <ThemeColorField key={key} label={key} value={themeDraft[key]} onChange={value => changeDraftColor(key, value)} />)}
          <div><button type="button" disabled={!themeDraft.name.trim()} onClick={() => { update({ customThemes: [...settings.customThemes, themeDraft], theme: themeDraft.id }); setThemeDraft(null); setThemeOpen(false); }}>Add theme</button><button type="button" onClick={() => setThemeDraft(null)}>Cancel</button></div>
        </div>}
        {interfacePresets.filter(theme => theme.id !== "blue").map(theme => <button type="button" key={theme.id} title={theme.name} aria-label={theme.name} aria-pressed={settings.theme === theme.id} style={{ background: theme.border }} onClick={() => { update({ theme: theme.id }); setThemeOpen(false); }} />)}

      </div>}
      </div>
      {range("guiScale", "GUI size", "Changes interface size without resizing the sidebars or scaling the left sidebar.", 80, 150, 10, true)}
      {toggle("showItemIds", "Show item IDs in tooltips", "Adds the game's item identifier to item tooltips.")}
    </section>
    <section className="settings-section" aria-labelledby="settings-lines-heading">
      <h3 id="settings-lines-heading">Connection lines</h3>
      {range("lineThickness", "Line thickness", "Changes connection line thickness and scales the arrows or animated item images with it.", 2, 12, 1)}
      {toggle("overviewLineItems", "Show line items when zoomed out", "Shows item names and images on zoomed-out connections. Temporarily disabled while animated item images are active.")}
      {toggle("detailLineItems", "Show line cards when zoomed in", "Shows connection item and rate cards in the detailed diagram view. Individual lines can override this in their right-click menu.")}
      {toggle("crossingBridges", "Show crossing shadows", "Adds shadows at line crossings to distinguish overlapping connections.")}
    </section>
    <section className="settings-section" aria-labelledby="settings-animation-heading">
      <h3 id="settings-animation-heading">Arrows &amp; animation</h3>
      {toggle("disableArrows", "Disable arrows", "Hides direction arrows and disables arrow and item-image animation.")}
      {toggle("animatedArrows", "Animated arrows", "Moves arrows along connections in the direction of production flow. Requires arrows to be enabled.")}
      {toggle("animatedItemImages", "Use item images instead of arrows", "Replaces animated arrows with connected item images. Hides zoomed-out line items while active. Hover over an image to see its name.")}
      {itemAnimation && <>
        {range("animatedItemSize", "Item image size", "Scales the moving item images relative to their normal size. Does not change arrow size.", 50, 300, 10, true)}
        {range("animatedItemSpacing", "Item spacing", "Sets the distance between moving item centers along the line, including around corners. Overlapping connections remain synchronized.", 40, 480, 20)}
      </>}
    </section>
    <section className="settings-section" aria-labelledby="settings-grouping-heading">
      <h3 id="settings-grouping-heading">Grouping sidebar</h3>
      {toggle("connectionTree", "Enable connection tree", "Shows recipe connections beside machine rows and enables the tree visibility button.")}
      {toggle("sidebarGroupThemes", "Use diagram group colors", "Uses each diagram group's theme in the grouping sidebar. Transparent groups use the default sidebar theme.")}
    </section>
    <div className="settings-option settings-reset-row">
      <button type="button" onClick={() => update(defaultDisplaySettings)}><RotateCcw size={13} aria-hidden="true" /> Reset settings</button>
      <SettingsHelp label="Reset settings" text="Restores all display settings to their defaults. Changes are saved for this browser session." />
    </div>
  </section>;
}
