// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 烁皓
// Extracted verbatim from shuohao-skills novel-staging.mjs.
// Source: https://github.com/eternityspring/shuohao-skills/blob/5612d2a0bd5f19d978c3ee19d1e42840335e3b4b/skills/novel-staging/scripts/novel-staging.mjs
// Adaptation: omitted Node CLI/file I/O and HTML/Markdown renderer; pure algorithms unchanged.
// Regenerate with: node scripts/extract_staging_core.mjs
// See staging-provenance.json and staging-LICENSE.txt / staging-NOTICE.txt.

export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|·]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'scene';
}

/* ------------------------------------------------------------------ */
/* core — 站位的几何与说法                                              */
/* ------------------------------------------------------------------ */
/*
 * 报告页面上拖人、命令行写走位句、质量门，三处用的是同一份算法：这个函数整个
 * 被 toString() 嵌进报告页面，改一处两边一起变。所以函数体里不许引用外面的任何东西。
 *
 * 平面坐标：把房间摆平从正上方看，北在上、西在左，0–1，从西北角量起。
 * 主视角（场景图的标准取景）的机位在南侧向北看：图的左边是西、右边是东、越往上越靠北。
 */
export function stagingCore() {
  const SIDES = ['north', 'east', 'south', 'west', 'on'];
  const POSTURES = ['sit', 'stand'];
  const FACINGS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  /** 人站在一件东西边上时，离它的边多远。 */
  const PLAN_GAP = 0.04;
  /** 同一件东西同一侧的两个人，along 至少差这么多才不算叠在一处。 */
  const MIN_APART = 0.12;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  const ZH_SIDE = { north: '北侧', east: '东侧', south: '南侧', west: '西侧' };
  const ZH_FACING = {
    north: '北', northeast: '东北', east: '东', southeast: '东南', south: '南', southwest: '西南', west: '西', northwest: '西北',
  };
  /** 东西两侧沿南北排，南北两侧沿东西排。 */
  const runsNorthSouth = (side) => side === 'east' || side === 'west';

  /** 从正上方看是圆的（圆桌、圆地毯）：画成圆，人围着它一圈。没写 round 就看名字。 */
  const isRound = (i) => (typeof i.round === 'boolean' ? i.round : /圆|round|circular|oval/i.test(`${i.name} ${i.alt ?? ''}`));

  function alongWord(side, along, lang) {
    if (side === 'on') return '';
    const third = along < 1 / 3 ? 0 : along > 2 / 3 ? 2 : 1;
    if (runsNorthSouth(side)) {
      return lang === 'zh' ? ['靠北', '中段', '靠南'][third] : ['toward the north end', 'in the middle', 'toward the south end'][third];
    }
    return lang === 'zh' ? ['靠西', '', '靠东'][third] : ['toward the west end', '', 'toward the east end'][third];
  }

  /**
   * 一个人的位置写成一句走位：「胡二爷坐在左舷长坐板上，面朝东」。`after` 是同一件东西
   * 同一侧排在他前面的那个人（「…东侧中段、胡二爷南侧」），落在同一段里也说得清先后。
   */
  function placeSentence(p, lang, after, itemName) {
    const thing = itemName ?? p.item;
    if (!p.present || !p.item || !thing) return null;
    const step = runsNorthSouth(p.side) ? 'south' : 'east';
    if (lang === 'zh') {
      const verb = p.posture === 'sit' ? '坐在' : '站在';
      const where = p.side === 'on'
        ? `${thing}上`
        : `${thing}${ZH_SIDE[p.side]}${alongWord(p.side, p.along, 'zh')}${after ? `、${after.name}${step === 'south' ? '南' : '东'}侧` : ''}`;
      return `${p.name}${verb}${where}，面朝${ZH_FACING[p.facing] ?? p.facing}`;
    }
    const verb = p.posture === 'sit' ? 'sits' : 'stands';
    const where = p.side === 'on'
      ? `on the ${thing}`
      : [`on the ${p.side} side of the ${thing}`, alongWord(p.side, p.along, 'en'), after ? `just ${step} of ${after.name}` : '']
          .filter(Boolean).join(', ');
    return `${p.name} ${verb} ${where}, facing ${p.facing}`;
  }

  /** 同一件东西同一侧，每个人前面紧挨着的是谁（按 along 排）。 */
  function neighbours(places) {
    const groups = new Map();
    for (const p of places) {
      if (!p.present || !p.item || p.side === 'on') continue;
      const key = `${p.item}:${p.side}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const before = new Map();
    for (const list of groups.values()) {
      const sorted = [...list].sort((a, b) => a.along - b.along);
      sorted.forEach((p, i) => { if (i > 0) before.set(p.id, sorted[i - 1]); });
    }
    return before;
  }

  function extrasSentence(s, lang) {
    const where = (s.extrasWhere ?? '').trim();
    if (!(s.extras > 0)) return lang === 'zh' ? '其余座位空着，没有其他人' : 'every other seat is empty and nobody else is there';
    return lang === 'zh'
      ? `另有 ${s.extras} 名群演${where ? `在${where}` : ''}，只作背景`
      : `${s.extras} extra${s.extras === 1 ? '' : 's'}${where ? ` ${where}` : ''}, background only`;
  }

  /**
   * 这一场的开场走位：在场的每个人一句，按站位表的顺序，最后一句交代还有没有别人。
   * 分镜这一场第一段的开场走位就照抄它。`nameIn` 把东西的名字换成另一种语言。
   */
  function stagingBlocking(scene, lang, nameIn) {
    const places = (scene.places ?? []).filter((p) => p.present && p.item);
    const before = neighbours(places);
    const clauses = places
      .map((p) => placeSentence(p, lang, before.get(p.id), nameIn ? nameIn(p.item) : p.item))
      .filter(Boolean);
    if (!clauses.length) return null;
    clauses.push(extrasSentence(scene, lang));
    return lang === 'zh' ? `${clauses.join('；')}。` : `${clauses.join('; ')}.`;
  }

  /** 面朝他所在的那件东西：在它东侧就面朝西。在它上面就面朝房间——背对它靠着的那面墙，不靠墙就朝南（机位）。 */
  function defaultFacing(side, item) {
    if (side === 'east') return 'west';
    if (side === 'west') return 'east';
    if (side === 'north') return 'south';
    if (side === 'south') return 'north';
    if (!item) return 'south';
    const cx = (item.plan[0] + item.plan[2]) / 2;
    if (cx < 0.25) return 'east';
    if (cx > 0.75) return 'west';
    return 'south';
  }

  /*
   * 圆的东西一侧是四分之一圈，along 沿这段弧走，跟沿直边走一样：南侧是下面那段，从西南（0）
   * 到东南（1）；东侧是右边那段，从东北（0）到东南（1）。角度在平面上量，y 朝下：0 是东、90 是南。
   */
  const ARC_START = { south: 135, west: 225, north: 225, east: -45 };
  const ARC_TURN = { south: -90, west: -90, north: 90, east: 90 };

  function arcPlace(deg) {
    const a = ((deg % 360) + 360) % 360;
    if (a > 45 && a <= 135) return { side: 'south', along: (135 - a) / 90 };
    if (a > 135 && a <= 225) return { side: 'west', along: (225 - a) / 90 };
    if (a > 225 && a <= 315) return { side: 'north', along: (a - 225) / 90 };
    return { side: 'east', along: ((a > 315 ? a - 360 : a) + 45) / 90 };
  }

  /** 一个位置画在平面上的哪一点。 */
  function placePoint(item, side, along, spread = 0) {
    const [x0, y0, x1, y1] = item.plan;
    const t = clamp01(along ?? 0.5);
    if (side !== 'on' && isRound(item)) {
      const deg = ((ARC_START[side] + ARC_TURN[side] * t) * Math.PI) / 180;
      return {
        x: clamp01((x0 + x1) / 2 + ((x1 - x0) / 2 + PLAN_GAP) * Math.cos(deg)),
        y: clamp01((y0 + y1) / 2 + ((y1 - y0) / 2 + PLAN_GAP) * Math.sin(deg)),
      };
    }
    let p;
    if (side === 'north') p = { x: x0 + (x1 - x0) * t, y: y0 - PLAN_GAP };
    else if (side === 'south') p = { x: x0 + (x1 - x0) * t, y: y1 + PLAN_GAP };
    else if (side === 'west') p = { x: x0 - PLAN_GAP, y: y0 + (y1 - y0) * t };
    else if (side === 'east') p = { x: x1 + PLAN_GAP, y: y0 + (y1 - y0) * t };
    // 在它上面：放在中间，几个人就并排
    else p = { x: (x0 + x1) / 2 + (x1 - x0) * 0.2 * spread, y: (y0 + y1) / 2 };
    return { x: clamp01(p.x), y: clamp01(p.y) };
  }

  /**
   * 每个在场的人画在平面上的哪一点，按句子里说的（东西、哪一侧、沿着多远）算——画出来的跟写出来的
   * 永远是一回事。几个人在同一件东西上就并排。东西不在 items 里的人没有点。
   */
  function placePoints(places, items) {
    const byName = new Map(items.map((i) => [i.name, i]));
    const onSoFar = new Map();
    const out = new Map();
    for (const p of places) {
      const it = p.present && p.item ? byName.get(p.item) : undefined;
      if (!it) continue;
      let spread = 0;
      if (p.side === 'on') {
        const k = onSoFar.get(it.name) ?? 0;
        onSoFar.set(it.name, k + 1);
        spread = k === 0 ? 0 : k % 2 ? (k + 1) / 2 : -k / 2;
      }
      out.set(p.id, placePoint(it, p.side, p.along, spread));
    }
    return out;
  }

  /**
   * 拖到平面上某一点松手，人落在哪：落在能坐能站的东西里面（最小的那件）就在它上面；否则落在
   * 最近那件东西最近的一侧、沿这一侧多远——松在桌面上就是桌子最近的那条边。
   */
  function nearestPlace(pt, items) {
    const inside = (b) => pt.x >= b[0] && pt.x <= b[2] && pt.y >= b[1] && pt.y <= b[3];
    const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    const seat = items.filter((i) => i.on && inside(i.plan)).sort((a, b) => area(a.plan) - area(b.plan))[0];
    if (seat) return { item: seat.name, side: 'on', along: 0.5 };
    let best = null;
    for (const i of items) {
      const [x0, y0, x1, y1] = i.plan;
      if (isRound(i)) {
        const rx = (x1 - x0) / 2 || 0.001;
        const ry = (y1 - y0) / 2 || 0.001;
        const dx = pt.x - (x0 + x1) / 2;
        const dy = pt.y - (y0 + y1) / 2;
        const deg = Math.atan2(dy / ry, dx / rx);
        const d = Math.hypot(dx - rx * Math.cos(deg), dy - ry * Math.sin(deg));
        const bias = (dx / rx) ** 2 + (dy / ry) ** 2 <= 1 ? -1 + area(i.plan) * 0.01 : 0;
        if (!best || d + bias < best.d) best = { item: i.name, ...arcPlace((deg * 180) / Math.PI), d: d + bias };
        continue;
      }
      const cx = Math.min(x1, Math.max(x0, pt.x));
      const cy = Math.min(y1, Math.max(y0, pt.y));
      const sides = [
        ['north', Math.hypot(pt.x - cx, pt.y - y0), clamp01((pt.x - x0) / (x1 - x0 || 1))],
        ['south', Math.hypot(pt.x - cx, pt.y - y1), clamp01((pt.x - x0) / (x1 - x0 || 1))],
        ['west', Math.hypot(pt.x - x0, pt.y - cy), clamp01((pt.y - y0) / (y1 - y0 || 1))],
        ['east', Math.hypot(pt.x - x1, pt.y - cy), clamp01((pt.y - y0) / (y1 - y0 || 1))],
      ];
      // 点在某件东西里面就算它最近，不管哪条边；两件都罩着它时取小的那件
      const bias = inside(i.plan) ? -1 + area(i.plan) * 0.01 : 0;
      for (const [side, d, along] of sides) {
        if (!best || d + bias < best.d) best = { item: i.name, side, along, d: d + bias };
      }
    }
    return best ? { item: best.item, side: best.side, along: best.along } : null;
  }

  /**
   * 拖动后这个人怎么变：换了东西或换了一侧就转过去面朝它；落在能坐的东西上就坐下；
   * 原来不在场、刚拖进来的人站着。
   */
  function moveTo(place, target, items) {
    const it = items.find((i) => i.name === target.item);
    const turned = !place.present || target.side !== place.side || target.item !== place.item;
    return {
      ...place,
      present: true,
      item: target.item,
      side: target.side,
      along: target.side === 'on' ? 0.5 : Math.round(target.along * 100) / 100,
      posture: target.side === 'on' && it?.on ? 'sit' : !place.present ? 'stand' : place.posture ?? 'stand',
      facing: turned ? defaultFacing(target.side, it) : place.facing,
    };
  }

  /**
   * 一场的站位哪里不对：质量门按 gate 汇总，报告页面上改一下就重算一遍。
   * `location` 是这一场所在地点的认图结果。
   */
  function sceneProblems(scene, location, lang = 'zh') {
    const zh = lang === 'zh';
    const out = [];
    const add = (gate, text) => out.push({ gate, text });
    const items = location?.items ?? [];
    const things = new Map(items.map((i) => [i.name, i]));
    const cast = scene.cast ?? [];
    const places = scene.places ?? [];
    const ids = places.map((p) => p.id);
    const castIds = cast.map((c) => c.id);
    const missing = cast.filter((c) => !ids.includes(c.id)).map((c) => c.name);
    if (missing.length) add('cast-complete', zh ? `站位表里少了：${missing.join('、')}` : `missing from the places: ${missing.join(', ')}`);
    const extra = places.filter((p) => !castIds.includes(p.id)).map((p) => p.name ?? p.id);
    if (extra.length) add('cast-complete', zh ? `出场人物表以外的人：${extra.join('、')}` : `not in the scene's cast: ${extra.join(', ')}`);
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (twice.length) add('cast-complete', zh ? `同一个人写了两次：${[...new Set(twice)].join('、')}` : `listed twice: ${[...new Set(twice)].join(', ')}`);

    const undecided = places.filter((p) => typeof p.present !== 'boolean').map((p) => p.name);
    if (undecided.length) add('present-set', zh ? `还没定开场在不在：${undecided.join('、')}` : `not yet said whether they are there at the opening: ${undecided.join(', ')}`);
    else if (places.length && !places.some((p) => p.present)) add('present-set', zh ? '开场一个人都不在' : 'nobody is there when the scene opens');

    for (const p of places) {
      if (p.present === false) {
        if (p.item != null || p.side != null || p.along != null) {
          add('place-valid', zh ? `${p.name} 开场不在，item、side、along 要空着` : `${p.name} is not there at the opening: leave item, side and along empty`);
        }
        continue;
      }
      if (p.present !== true) continue;
      const it = things.get(p.item);
      if (!it) add('place-valid', zh ? `${p.name} 站的「${p.item ?? ''}」不在这个地点认出来的东西里` : `${p.name}'s "${p.item ?? ''}" is not one of the things read off this place`);
      if (!SIDES.includes(p.side)) add('place-valid', zh ? `${p.name} 的 side 要是 north / east / south / west / on` : `${p.name}'s side must be north / east / south / west / on`);
      else if (p.side === 'on' && it && !it.on) add('place-valid', zh ? `${p.name} 写了在「${p.item}」上，可它上面不能坐也不能站，写它的哪一侧` : `${p.name} is on the "${p.item}", which nobody can sit or stand on: say which side`);
      if (p.side !== 'on' && !(typeof p.along === 'number' && p.along >= 0 && p.along <= 1)) {
        add('place-valid', zh ? `${p.name} 的 along 要是 0 到 1 之间的数` : `${p.name}'s along must be a number from 0 to 1`);
      }
      if (!POSTURES.includes(p.posture)) add('place-valid', zh ? `${p.name} 的 posture 要是 sit 或 stand` : `${p.name}'s posture must be sit or stand`);
      if (!FACINGS.includes(p.facing)) add('place-valid', zh ? `${p.name} 的 facing 要是八个方位之一` : `${p.name}'s facing must be one of the eight directions`);
    }

    const sideGroups = new Map();
    for (const p of places) {
      if (p.present !== true || !things.has(p.item) || p.side === 'on' || typeof p.along !== 'number') continue;
      const key = `${p.item}:${p.side}`;
      sideGroups.set(key, [...(sideGroups.get(key) ?? []), p]);
    }
    for (const list of sideGroups.values()) {
      const sorted = [...list].sort((a, b) => a.along - b.along);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        if (b.along - a.along < MIN_APART) {
          add('no-overlap', zh
            ? `${a.name} 和 ${b.name} 叠在「${b.item}」${ZH_SIDE[b.side]}同一处，沿这一侧拉开`
            : `${a.name} and ${b.name} stand on one spot on the ${b.side} side of the "${b.item}": spread them along it`);
        }
      }
    }

    if (!(Number.isInteger(scene.extras) && scene.extras >= 0)) add('extras', zh ? '群演人数要是 0 或正整数（剧本没写有别人就是 0）' : 'extras must be 0 or a whole number (0 when the script names nobody else)');
    else if (scene.extras > 0 && !(scene.extrasWhere ?? '').trim()) add('extras', zh ? `有 ${scene.extras} 名群演，没写他们在哪` : `${scene.extras} extras, but not where they are`);
    else if (scene.extras === 0 && (scene.extrasWhere ?? '').trim()) add('extras', zh ? '没有群演，extrasWhere 要空着' : 'no extras: leave extrasWhere empty');
    return out;
  }

  return {
    SIDES, POSTURES, FACINGS, PLAN_GAP, MIN_APART, ZH_FACING,
    isRound, placeSentence, extrasSentence, stagingBlocking, defaultFacing,
    placePoint, placePoints, nearestPlace, moveTo, sceneProblems,
  };
}

const core = stagingCore();
export const {
  SIDES, POSTURES, FACINGS, PLAN_GAP, MIN_APART,
  isRound, placeSentence, extrasSentence, stagingBlocking, defaultFacing,
  placePoint, placePoints, nearestPlace, moveTo, sceneProblems,
} = core;

/** 认图结果里东西的件数范围：少了排不开人，多了是把杯子碗碟也写进来了。 */
export const ITEM_RANGE = [4, 20];

/* ------------------------------------------------------------------ */
/* seed — 从剧本确定性预填骨架                                          */
/* ------------------------------------------------------------------ */
/*
 * 有哪几场、每场在哪个地点、谁出场，剧本里都是现成的——这些不该让模型重新想一遍。
 * seed 把它们搬进骨架；模型只做两件事：认每个地点的图，给每一场排开场站位。
 */

/** `1-3`、`2`、`1,3,5` → 集号集合；不给就是全部。 */
export function parseEps(spec) {
  if (!spec) return null;
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const [a, b] = part.split('-').map((x) => Number(x.trim()));
    if (!Number.isInteger(a)) throw new Error(`集号写法不对：${spec}`);
    for (let n = a; n <= (Number.isInteger(b) ? b : a); n++) out.add(n);
  }
  return out;
}

export function seedFromScript(script, { art = null, outline = null, eps = null } = {}) {
  const names = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));
  const artScenes = new Map((art?.scenes ?? []).map((s) => [s.id, s]));
  const scenes = [];
  const locationIds = [];
  for (const ep of script?.episodes ?? []) {
    if (eps && !eps.has(ep.ep)) continue;
    (ep.scenes ?? []).forEach((sc, i) => {
      if (sc.sceneId && !locationIds.includes(sc.sceneId)) locationIds.push(sc.sceneId);
      const cast = (sc.characters ?? []).map((id) => ({ id, name: names.get(id) ?? id }));
      scenes.push({
        ep: ep.ep,
        scene: i + 1,
        sceneId: sc.sceneId ?? null,
        ...(sc.lighting ? { lighting: sc.lighting } : {}),
        cast,
        // 模型要定的：开场在不在、在哪件东西的哪一侧、坐还是站、面朝哪
        places: cast.map((c) => ({ id: c.id, name: c.name, present: null, item: null, side: null, along: null, posture: null, facing: null })),
        extras: null,
        extrasWhere: null,
      });
    });
  }
  const locations = locationIds.map((id) => ({ sceneId: id, name: artScenes.get(id)?.name ?? id, readFrom: null, items: [] }));
  return { source: script?.source ?? '', lang: script?.lang ?? 'zh', locations, scenes };
}

/* ------------------------------------------------------------------ */
/* 质量门                                                              */
/* ------------------------------------------------------------------ */

const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && v >= 0 && v <= 1) && b[2] > b[0] && b[3] > b[1];

export function sceneLabel(s, lang = 'zh') {
  return lang === 'zh' ? `第 ${s.ep} 集第 ${s.scene} 场` : `E${s.ep} scene ${s.scene}`;
}

/** 一个地点的认图结果哪里不对。 */
export function locationProblems(loc) {
  const out = [];
  const items = Array.isArray(loc.items) ? loc.items : [];
  if (!loc.readFrom || !items.length) {
    out.push({ gate: 'items-read', text: `「${loc.name}」还没认图` });
    return out;
  }
  if (!['picture', 'prompt'].includes(loc.readFrom)) out.push({ gate: 'items-read', text: `「${loc.name}」的 readFrom 要是 picture 或 prompt` });
  if (items.length < ITEM_RANGE[0] || items.length > ITEM_RANGE[1]) {
    out.push({ gate: 'items-read', text: `「${loc.name}」认出 ${items.length} 件，要 ${ITEM_RANGE[0]}–${ITEM_RANGE[1]} 件` });
  }
  const names = items.map((i) => String(i.name ?? '').trim());
  const twice = names.filter((n, i) => n && names.indexOf(n) !== i);
  if (twice.length) out.push({ gate: 'item-shape', text: `「${loc.name}」里名字重复：${[...new Set(twice)].join('、')}` });
  for (const i of items) {
    const n = String(i.name ?? '').trim();
    if (!n) out.push({ gate: 'item-shape', text: `「${loc.name}」里有一件东西没写名字` });
    if (!isBox(i.plan)) out.push({ gate: 'item-shape', text: `「${loc.name}·${n}」的 plan 要四个 0 到 1 的数，右大于左、下大于上` });
    // 按图认的才有框；没有图、按提示词推算的没有图上的位置
    if (loc.readFrom === 'picture' && !isBox(i.box)) out.push({ gate: 'item-shape', text: `「${loc.name}·${n}」的 box 要四个 0 到 1 的数，右大于左、下大于上` });
    if (typeof i.on !== 'boolean') out.push({ gate: 'item-shape', text: `「${loc.name}·${n}」的 on 要写 true 或 false` });
    if (i.round !== undefined && typeof i.round !== 'boolean') out.push({ gate: 'item-shape', text: `「${loc.name}·${n}」的 round 要写 true 或 false` });
  }
  return out;
}

const GATES = [
  { id: 'items-read', label: `每个地点都认了图，${ITEM_RANGE[0]}–${ITEM_RANGE[1]} 件东西` },
  { id: 'item-shape', label: '东西的名字不重复，平面位置和图上位置都是合法的框' },
  { id: 'location-ref', label: '每一场的地点都有认图结果' },
  { id: 'cast-complete', label: '每一场的出场人物正好各一条' },
  { id: 'present-set', label: '每个人都定了开场在不在，至少一个人在场' },
  { id: 'place-valid', label: '在场的人落在认出来的东西上，方位、坐站、朝向合法' },
  { id: 'no-overlap', label: '同一侧的人不叠在一处' },
  { id: 'extras', label: '群演人数是整数，有群演写明在哪' },
];

const GATE_LABELS_EN = {
  'items-read': `Every place read, ${ITEM_RANGE[0]}–${ITEM_RANGE[1]} things`,
  'item-shape': 'Thing names unique; plan and picture boxes well formed',
  'location-ref': 'Every scene’s place has been read',
  'cast-complete': 'Every scene lists each of its cast exactly once',
  'present-set': 'Everyone marked there or not at the opening; someone is there',
  'place-valid': 'People stand at things read off the place; side, posture and facing valid',
  'no-overlap': 'Nobody stands on one spot with another on the same side',
  'extras': 'Extras are a whole number, and where they are is said',
};

/** 全部违规，每条带场次或地点。`script` 给了就核对出场人物跟剧本一致，`art` 给了就核对地点编号。 */
export function stagingProblems(doc, { script = null, art = null } = {}) {
  const out = [];
  const locations = Array.isArray(doc?.locations) ? doc.locations : [];
  const scenes = Array.isArray(doc?.scenes) ? doc.scenes : [];
  const byId = new Map(locations.map((l) => [l.sceneId, l]));
  for (const loc of locations) out.push(...locationProblems(loc));
  if (art) {
    const known = new Set((art.scenes ?? []).map((s) => s.id));
    for (const loc of locations) if (!known.has(loc.sceneId)) out.push({ gate: 'location-ref', text: `地点 ${loc.sceneId} 不在 art.json 里` });
  }
  for (const s of scenes) {
    const label = sceneLabel(s);
    const loc = byId.get(s.sceneId);
    if (!loc) out.push({ gate: 'location-ref', text: `${label} 的地点 ${s.sceneId ?? '（空）'} 没有认图结果` });
    if (script) {
      const sc = (script.episodes ?? []).find((e) => e.ep === s.ep)?.scenes?.[s.scene - 1];
      const want = sc?.characters ?? null;
      const have = (s.cast ?? []).map((c) => c.id);
      if (!sc) out.push({ gate: 'cast-complete', text: `${label} 在 script.json 里找不到` });
      else if (want.length !== have.length || want.some((id) => !have.includes(id))) {
        out.push({ gate: 'cast-complete', text: `${label} 的出场人物跟剧本不一致：剧本 ${want.join('、')}，这里 ${have.join('、')}` });
      }
    }
    for (const p of sceneProblems(s, loc)) out.push({ gate: p.gate, text: `${label}：${p.text}` });
  }
  return out;
}

export function validateStaging(doc, opts = {}) {
  return stagingProblems(doc, opts).map((p) => p.text);
}

/** 每道门 ✓/✗；没给 script.json 时「出场人物跟剧本一致」那一半明说没查。 */
export function gateReport(doc, opts = {}) {
  const problems = stagingProblems(doc, opts);
  return GATES.map((g) => {
    const mine = problems.filter((p) => p.gate === g.id);
    const skipped = g.id === 'cast-complete' && !opts.script;
    return {
      id: g.id,
      label: g.label,
      ok: !mine.length,
      detail: mine.length ? mine.slice(0, 3).map((p) => p.text).join('；') + (mine.length > 3 ? ` 等 ${mine.length} 处` : '') : skipped ? '未提供 script.json：只查站位表自己，没跟剧本核对' : '',
    };
  });
}

/* ------------------------------------------------------------------ */
/* blocking — 每场的开场走位句                                          */
/* ------------------------------------------------------------------ */

/** 东西名字换成另一种语言（认图时写的 alt），没写 alt 就用原名。 */
export function nameInFor(doc, scene, lang) {
  if (lang === (doc.lang ?? 'zh')) return undefined;
  const loc = (doc.locations ?? []).find((l) => l.sceneId === scene.sceneId);
  const alt = new Map((loc?.items ?? []).map((i) => [i.name, i.alt || i.name]));
  return (name) => alt.get(name) ?? name;
}

export function blockingLines(doc, lang = null) {
  const code = lang ?? doc.lang ?? 'zh';
  return (doc.scenes ?? []).map((s) => ({ scene: s, label: sceneLabel(s, code), blocking: stagingBlocking(s, code, nameInFor(doc, s, code)) }));
}

