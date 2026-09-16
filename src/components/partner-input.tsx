'use client';
import { useId, useMemo, useState } from 'react';
import { partnerKey, uniquePartnerNames } from '@/lib/partner-names';

export function PartnerInput({ names }: { names: string[] }) {
  const id = useId();
  const [value, setValue] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const candidates = useMemo(() => uniquePartnerNames(names), [names]);
  const query = partnerKey(value);
  const matches = query ? candidates.filter(name => partnerKey(name).startsWith(query)) : [];
  const expanded = open && matches.length > 0;
  function choose(name: string) { setValue(name); setOpen(false); setActive(-1); }
  return <div className="field partner-combobox"><label className="field-label" htmlFor={id}>출고업체</label>
    <input id={id} name="customer_name" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`} aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`} autoComplete="off" required maxLength={120} value={value} placeholder="거래처명을 입력하세요" onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); }} onChange={event => { setValue(event.target.value); setOpen(true); setActive(-1); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
        event.preventDefault(); setOpen(true);
        const next = event.key === 'ArrowDown' ? (active + 1) % matches.length : (active <= 0 ? matches.length : active) - 1;
        setActive(next); requestAnimationFrame(() => document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: 'nearest' }));
      }
      if (event.key === 'Enter' && expanded && active >= 0) { event.preventDefault(); choose(matches[active]); }
    }}/>
    <ul id={`${id}-list`} role="listbox" aria-label="거래처 추천" className="partner-suggestions" hidden={!expanded}>{matches.map((name, index) => <li role="option" aria-selected={index === active} id={`${id}-option-${index}`} key={name} onPointerDown={event => event.preventDefault()} onClick={() => choose(name)}>{name}</li>)}</ul>
    <p id={`${id}-help`} className="muted">{open && query && !matches.length ? '일치하는 거래처가 없습니다. 출고 완료 시 새 거래처로 등록됩니다.' : '입력한 이름으로 시작하는 거래처를 추천합니다. 출고 완료 시 중복 없이 자동 등록됩니다.'}</p>
  </div>;
}
