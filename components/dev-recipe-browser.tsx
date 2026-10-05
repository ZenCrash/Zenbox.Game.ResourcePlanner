"use client";
import { useEffect, useRef, useState } from 'react';
import { CodeXml, X, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { recipeTabIcon, type Recipe } from '@/lib/model';
import { CyclingRecipe, ItemSlot, type Browse } from './recipe-view';
import { useDisplaySettings } from './display-settings';
import { RecipeChevron } from './recipe-chevron';

type RecipeType = { name: string; count: number; icon: string | null };
export function DevRecipeBrowser({ onClose }: { onClose: () => void }) {
  const [types, setTypes] = useState<RecipeType[]>([]);
  const [handler, setHandler] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [total, setTotal] = useState(0);
  const [lookup, setLookup] = useState<{ id: string; mode: string; name: string }>();
  const [loading, setLoading] = useState(true);
  const [typesLoading, setTypesLoading] = useState(true);
  const [error, setError] = useState('');
  const tabs = useRef<HTMLDivElement>(null);
  const recipeContent = useRef<HTMLDivElement>(null);
  const { settings } = useDisplaySettings();
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(0); }, 200); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setTypesLoading(true); setError('');
    const url = lookup ? `/api/recipes?item=${encodeURIComponent(lookup.id)}&mode=${lookup.mode}` : `/api/dev-recipes?q=${encodeURIComponent(search)}`;
    void fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load recipe types');
      const data = await response.json();
      if (controller.signal.aborted) return;
      let next: RecipeType[];
      if (lookup) {
        const values = data as Recipe[];
        setRecipes(values);
        next = [...new Set(values.map(recipe => recipe.handler))].map(name => ({ name, count: values.filter(recipe => recipe.handler === name).length, icon: recipeTabIcon(values.find(recipe => recipe.handler === name)!) }));
      } else next = data;
      setTypes(next); setHandler(current => next.some(type => type.name === current) ? current : next[0]?.name ?? '');
      if (lookup || !next.length) setLoading(false);
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } }).finally(() => { if (!controller.signal.aborted) setTypesLoading(false); });
    return () => controller.abort();
  }, [search, lookup]);
  useEffect(() => {
    if (!handler || lookup) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    void fetch(`/api/dev-recipes?handler=${encodeURIComponent(handler)}&page=${page}&q=${encodeURIComponent(search)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load recipes');
      const data = await response.json();
      if (controller.signal.aborted) return;
      setRecipes(data.recipes); setTotal(data.total);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [handler, lookup, page, search]);
  useEffect(() => { tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [handler]);
  useEffect(() => {
    const content = recipeContent.current;
    const card = content?.querySelector<HTMLElement>(".recipe-view");
    if (!content || !card) return;
    const measure = () => {
      const bounds = card.getBoundingClientRect();
      // Screen rectangles include CSS zoom; the strip uses local CSS pixels.
      const cardHeight = bounds.height / settings.guiScale;
      content.style.setProperty(
        "--machine-strip-top",
        `${(bounds.top - content.getBoundingClientRect().top) / settings.guiScale}px`,
      );
      content.style.setProperty("--machine-strip-height", `${cardHeight}px`);
      const machines = content.querySelector<HTMLElement>(
        ".recipe-machine-slots",
      );
      if (machines && machines.children.length) {
        const styles = getComputedStyle(machines);
        const gap = parseFloat(styles.rowGap) || 0;
        const verticalInset =
          parseFloat(styles.paddingTop) +
          parseFloat(styles.paddingBottom) +
          parseFloat(styles.borderTopWidth) +
          parseFloat(styles.borderBottomWidth);
        const slotHeight = (machines.firstElementChild as HTMLElement)
          .offsetHeight;
        const visibleRows = Math.max(
          1,
          Math.floor(
            (cardHeight - verticalInset + gap) / (slotHeight + gap),
          ),
        );
        const count = machines.children.length;
        const columns = Math.min(3, Math.ceil(count / visibleRows));
        const rows =
          count > visibleRows * 3
            ? Math.ceil(count / 3)
            : Math.min(count, visibleRows);
        machines.style.gridTemplateColumns = `repeat(${columns}, 32px)`;
        machines.style.gridTemplateRows = `repeat(${rows}, 32px)`;
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [recipes, handler, page, loading, typesLoading, settings.guiScale]);
  const browse: Browse = (item, mode) => { setPage(0); setLookup({ id: item.id, name: item.name, mode }); };
  const filtered = lookup ? recipes.filter(recipe => recipe.handler === handler) : recipes;
  const recipe = types.length ? filtered[lookup ? page : 0] : undefined;
  const count = lookup ? filtered.length : total;
  const selectType = (name: string) => { setHandler(name); setPage(0); };
  const changeType = (direction: number) => { if (types.length) selectType(types[(types.findIndex(type => type.name === handler) + direction + types.length) % types.length].name); };
  return <div className="modal-backdrop recipe-browser-backdrop" onClick={onClose}>
    <div className="recipe-dialog dev-recipe-dialog" role="dialog" aria-modal="true" aria-label="Developer recipe browser" onClick={event => event.stopPropagation()}>
      <div className="recipe-browser-heading"><CodeXml size={24} /><div className="recipe-view"><h2 className="recipe-title">Recipe browser</h2></div><button aria-label="Close developer recipe browser" onClick={onClose}><X size={20} /></button></div>
      <label className="dev-recipe-type"><Search size={18} /><input aria-label="Search recipes and recipe types" placeholder="Search recipes, resources or recipe types…" value={query} onChange={event => { setLookup(undefined); setQuery(event.target.value); }} />{(query || lookup) && <button aria-label="Clear recipe search" onClick={() => { setLookup(undefined); setQuery(''); }}><X size={16} /></button>}</label>
      {lookup && <p className="dev-recipe-lookup">{lookup.name} — {lookup.mode}</p>}
      <div ref={recipeContent} className={`recipe-browser-content${recipe?.craftingMachines?.length ? ' has-machines' : ''}`}>
        <div className="recipe-tab-bar">
          <button className="recipe-tab-scroll" aria-label="Scroll recipe tabs left" onClick={() => tabs.current?.scrollBy({ left: -250, behavior: 'smooth' })}><ChevronLeft size={16} /></button>
          <div className="recipe-tabs" ref={tabs} role="tablist" aria-label="Recipe machines and crafting methods">{types.map(type => <button key={type.name} role="tab" aria-selected={handler === type.name} aria-label={type.name} title={type.name} className={handler === type.name ? 'active' : ''} onClick={() => selectType(type.name)}>{type.icon ? <img src={type.icon} alt="" draggable={false} /> : <CodeXml size={24} />}</button>)}</div>
          <button className="recipe-tab-scroll" aria-label="Scroll recipe tabs right" onClick={() => tabs.current?.scrollBy({ left: 250, behavior: 'smooth' })}><ChevronRight size={16} /></button>
        </div>
        <div className="recipe-handler-panel">
          {error ? <p role="alert" className="recipe-message">{error}</p> : loading || typesLoading ? <p className="recipe-message">Looking up recipes…</p> : recipe ? <CyclingRecipe key={recipe.id} recipe={recipe} readOnly disabled onSelect={() => {}} onBrowse={browse} navigation={{ previous: <button className="recipe-nav-button" aria-label="Previous recipe tab" disabled={types.length < 2} onClick={() => changeType(-1)}><RecipeChevron direction="left" /></button>, next: <button className="recipe-nav-button" aria-label="Next recipe tab" disabled={types.length < 2} onClick={() => changeType(1)}><RecipeChevron direction="right" /></button> }} pager={<div className="recipe-pager">
            <button className="recipe-nav-button" aria-label="Previous recipe" disabled={page === 0} onClick={() => setPage(value => value - 1)}><RecipeChevron direction="left" /></button><span>Page {page + 1}/{count}</span><button className="recipe-nav-button" aria-label="Next recipe" disabled={page + 1 >= count} onClick={() => setPage(value => value + 1)}><RecipeChevron direction="right" /></button>
          </div>} /> : <p className="recipe-message">No recipes found.</p>}
        </div>
        {!loading && !typesLoading && !!recipe?.craftingMachines?.length && <aside className="recipe-machine-slots" aria-label="Crafting machines" tabIndex={0}>{recipe.craftingMachines.map(machine => <ItemSlot key={machine.id} item={machine} onBrowse={browse} />)}</aside>}
      </div>
    </div>
  </div>;
}
