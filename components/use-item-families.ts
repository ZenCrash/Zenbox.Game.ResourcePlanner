"use client";
import { useEffect, useState } from 'react';
import type { Item } from '@/lib/model';

export function useItemFamilies(ids: string[]) {
  const [families, setFamilies] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<Record<string, Item>>({});
  const key = [...new Set(ids)].sort().join('\n');
  useEffect(() => {
    const missing = key.split('\n').filter(id => id && !families[id]);
    if (!missing.length) return;
    const controller = new AbortController();
    void (async () => {
      for (let start = 0; start < missing.length; start += 200) {
        const response = await fetch('/api/item-families', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(missing.slice(start, start + 200)), signal: controller.signal });
        if (!response.ok) return;
        const data: { families: Record<string, string[]>; items: Item[] } = await response.json();
        if (controller.signal.aborted) return;
        setFamilies(current => ({ ...current, ...data.families }));
        setItems(current => ({ ...current, ...Object.fromEntries(data.items.map(item => [item.id, item])) }));
      }
    })().catch(() => { /* Keep actions unavailable until variant data is known. */ });
    return () => controller.abort();
  }, [key]); // Cached families are retained for the lifetime of the wizard.
  return { families, items };
}
