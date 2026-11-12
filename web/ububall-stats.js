/* Box Score, Game Log rink event map, MVP scoring, and Replays library dialogs
   extracted from web/ububall.js as a standalone UMD view module. */
(function (root) {
  'use strict';

  const STATS_MAJOR = new Set(['Goal', 'Shot', 'Save', 'Foul']);

  function matchMvp(s) {
    const rating = i => s.goals[i] * 3 + s.assists[i] * 2 + s.saves[i] * 2 + (s.bigSaves?.[i] || 0) + (s.checks?.[i] || 0) * 0.5 + (s.topShot?.[i] || 0) / 10000;
    const mvp = [0, 1, 2, 3, 4, 5].reduce((best, i) => rating(i) > rating(best) ? i : best, 0);
    return rating(mvp) > 0 ? mvp : null;
  }

  function statsEventLabel(event) {
    const detail = event.outcome || (event.label?.toLowerCase() !== event.type.toLowerCase() ? event.label : null);
    return detail ? `${event.type} (${detail})` : event.type;
  }

  function statsEventTime(event, dt = 1 / 240) {
    const tenths = Math.floor(event.tick * dt * 10);
    const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
    return `${Math.floor(tenths / 600)}:${seconds}.${tenths % 10} · Turn ${event.turn}`;
  }

  // A file name from the replay's name, or the time it was recorded.
  function replayFileName(recorded, title = null) {
    const d = new Date(recorded), two = n => String(n).padStart(2, '0');
    return title?.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) ||
      `ububall-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  }

  function createStatsController({
    $,
    document,
    addEventListener,
    history,
    P,
    ububallMatch,
    ububallReplay,
    ubuRender,
    gameUi,
    onlineOrder,
    viewIndex,
    getFieldView,
    getSkaters,
    getThemeColors,
    drawRinkSurface,
    viewTally,
    getScores,
    getPhase,
    getOnline,
    getTheater,
    getRecording,
    getLastCompletedReplay,
    getLastSaved,
    getShot,
    getCameraMove,
    replayStore,
    libraryEntry,
    seekReplay,
    updateReplayBar,
    watchReplay,
    matchInProgress,
    finishCpuMatch,
    closeFirstTurnGuide,
    closeSummary,
    newMatch,
    exitMatchMode
  }) {
    let activeStatsContext = null;
    const deletedReplays = [];

    function replayStats({ replay, seat }) {
      const s = ububallReplay.stats(replay);
      s.seat = seat;
      for (const key of ['goals', 'assists', 'shots', 'saves', 'bigSaves', 'checks', 'touches', 'passes', 'topShot', 'skated', 'cards']) {
        s[key] = onlineOrder(s[key], seat);
      }
      if (seat) {
        s.control.reverse();
        s.side.reverse();
        for (const round of s.rounds) if (round.team !== null) round.team = 1 - round.team;
        for (const event of s.events) {
          if (event.actor !== null) event.actor = viewIndex(event.actor, seat);
          if (event.target != null) event.target = viewIndex(event.target, seat);
          if (event.team !== null) event.team = 1 - event.team;
          event.x = 1000 - event.x;
          event.y = 600 - event.y;
        }
      }
      return s;
    }

    function updateStatsRinkWidth() {
      const rw = $('rink')?.getBoundingClientRect().width || 1000;
      $('stats-dialog').style.setProperty('--rink-w', `${rw}px`);
    }

    function getStatsForContext(ctx) {
      if (ctx.type === 'replay') {
        const th = ctx.theater;
        th.stats ||= replayStats(th);
        return th.stats;
      }
      if (ctx.stats) return ctx.stats;
      const replay = ctx.replay;
      if (replay) {
        ctx.stats = replayStats({ replay, seat: replay.seat });
        return ctx.stats;
      }
      const { tally: t } = viewTally();
      const six = () => [0, 0, 0, 0, 0, 0];
      ctx.stats = {
        goals: [...t.goals], assists: [...t.assists], saves: [...t.saves],
        shots: [...(t.shots || six())], checks: [...(t.checks || six())],
        touches: six(), passes: six(), topShot: [...t.topSpeed], skated: six(),
        cards: [...t.cards], control: [50, 50], side: [50, 50], events: [], rounds: [], trails: [],
        bigSaves: t.bigSaves
      };
      return ctx.stats;
    }

    function statsEventText(event, names) {
      const entries = getFieldView().entries;
      const name = i => entries[i]?.model.parts.fullName;
      const actor = event.actor === null ? names[event.team] : name(event.actor);
      const target = event.target == null ? '' : ` to ${name(event.target)}`;
      return `${statsEventLabel(event)} · ${actor}${target}`;
    }

    function showStatsTab(ctx) {
      const log = ctx.tab === 'log';
      $('stats-box').hidden = log;
      $('stats-log').hidden = !log;
      $('stats-box-tab').setAttribute('aria-pressed', String(!log));
      $('stats-log-tab').setAttribute('aria-pressed', String(log));
      if (log) renderGameLog(ctx);
    }

    function renderGameLog(ctx) {
      const { events, rounds, trails, seat } = getStatsForContext(ctx);
      const { names } = ctx;
      const fieldView = getFieldView(), skaters = getSkaters();
      const roundName = round => round.team === null ? 'Unscored' : `${names[round.team]} #${round.score}`;
      const filters = $('stats-rounds');
      filters.replaceChildren();
      for (const [index, label] of ['ALL', ...rounds.map(roundName)].entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        const team = rounds[index - 1]?.team;
        if (team != null) button.dataset.team = team;
        button.onclick = () => { ctx.round = index - 1; updateLog(); };
        filters.append(button);
      }
      const map = $('stats-map'), detail = $('stats-map-detail'), log = $('stats-events');
      // Crop the rink's vertical gutter while keeping marks and trails in field coordinates.
      const mapTop = (P.rink.top + P.rink.bottom - map.height) / 2;
      const highlights = $('stats-highlights');
      const g = map.getContext('2d');
      const colors = getThemeColors();
      const { home, away, text } = colors;
      const rows = new Map();
      const portraits = ctx.portraits ??= fieldView.entries.slice(0, 6).map((entry, idx) => {
        const sprite = skaters?.[idx]?.querySelector?.('canvas');
        if (sprite && fieldView.entries[idx] === entry) {
          try { return sprite.toDataURL('image/png'); } catch {}
        }
        const svg = new XMLSerializer().serializeToString(ubuRender(entry.model, 'stats-portrait'));
        return `data:image/svg+xml,${encodeURIComponent(svg)}`;
      });
      function pill(index) {
        const player = document.createElement('span'), image = document.createElement('img');
        player.className = 'stats-player';
        player.dataset.team = index < 3 ? 0 : 1;
        image.alt = '';
        image.src = portraits[index];
        player.append(image, fieldView.entries[index].model.parts.fullName);
        return player;
      }
      let visible, shown, hovered = null, preview = [], marked = [];
      ctx.pinned ??= [];
      const active = event => ctx.round == null || ctx.round < 0 || event.round === ctx.round;
      const radius = event => event.type === 'Goal' ? 11 : STATS_MAJOR.has(event.type) ? 8 : 4;
      function drawMap() {
        const currentColors = getThemeColors();
        g.resetTransform();
        g.clearRect(0, 0, map.width, map.height);
        g.translate(0, -mapTop);
        drawRinkSurface(g, currentColors);
        if (marked.length || ctx.ballTrail || ctx.ubuTrails) {
          g.save();
          if (seat) g.transform(-1, 0, 0, -1, map.width, P.rink.top + P.rink.bottom);
          g.lineCap = g.lineJoin = 'round';
          for (let i = 0; i < 7; i++) {
            if (i === 6 ? !ctx.ballTrail : !ctx.ubuTrails) continue;
            g.strokeStyle = i === 6 ? text : ((i < 3) !== Boolean(seat) ? home : away);
            g.globalAlpha = i === 6 ? 0.8 : 0.45;
            g.lineWidth = i === 6 ? 3 : 2;
            g.beginPath();
            for (const trail of trails) {
              if (!active(trail)) continue;
              const { samples } = trail, start = i * 2;
              g.moveTo(samples[start], samples[start + 1]);
              for (let n = start + 14; n < samples.length; n += 14) g.lineTo(samples[n], samples[n + 1]);
            }
            g.stroke();
          }
          for (const event of marked) {
            if (!event.path) continue;
            const { from, to } = event.path;
            g.strokeStyle = event.team === 0 ? home : away;
            g.globalAlpha = 1;
            g.lineWidth = 4;
            g.beginPath();
            for (let i = from.turnIndex; i <= to.turnIndex; i++) {
              const { startTick, endTick, samples } = trails[i];
              if (i === from.turnIndex) g.moveTo(from.x, from.y);
              else g.moveTo(samples[12], samples[13]);
              for (let n = 26, k = 1; n < samples.length; n += 14, k++) {
                const tick = Math.min(endTick, startTick + k * 8);
                if (tick > from.tick && tick < to.tick) g.lineTo(samples[n], samples[n + 1]);
              }
              if (i === to.turnIndex) g.lineTo(to.x, to.y);
            }
            g.stroke();
            g.fillStyle = g.strokeStyle;
            g.beginPath();
            g.arc(to.x, to.y, 3, 0, Math.PI * 2);
            g.fill();
          }
          g.restore();
        }
        for (const layer of [shown.filter(event => !active(event)), visible.filter(event => !STATS_MAJOR.has(event.type)), visible.filter(event => STATS_MAJOR.has(event.type))]) {
          for (const event of layer) {
            g.globalAlpha = !active(event) ? 0.13 : STATS_MAJOR.has(event.type) ? 1 : 0.65;
            g.fillStyle = event.team === 0 ? home : away;
            g.beginPath();
            g.arc(event.x, event.y, radius(event), 0, Math.PI * 2);
            g.fill();
            if (STATS_MAJOR.has(event.type)) {
              g.strokeStyle = text;
              g.lineWidth = event.type === 'Goal' ? 4 : 2;
              g.stroke();
            }
          }
        }
        g.globalAlpha = 1;
        for (const event of marked) {
          g.strokeStyle = text;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(event.x, event.y, radius(event) + 6, 0, Math.PI * 2);
          g.stroke();
        }
      }
      function updateMarks() {
        for (const event of marked) rows.get(event)?.classList.remove('highlighted');
        marked = [...new Set([...ctx.pinned, ...preview])];
        for (const event of marked) rows.get(event)?.classList.add('highlighted');
        drawMap();
      }
      function pin(events) {
        const same = events.length === ctx.pinned.length && events.every((event, i) => event === ctx.pinned[i]);
        ctx.pinned = same ? [] : events;
        updateMarks();
      }
      function updateLog() {
        [...filters.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i - 1 === (ctx.round ?? -1))));
        highlights.setAttribute('aria-pressed', String(Boolean(ctx.highlights)));
        highlights.textContent = ctx.highlights ? 'Highlights only' : 'All events';
        shown = ctx.highlights ? events.filter(event => STATS_MAJOR.has(event.type)) : events;
        visible = shown.filter(active);
        ctx.pinned = ctx.pinned.filter(event => visible.includes(event));
        preview = [];
        hovered = null;
        detail.textContent = 'Hover to preview. Click to pin or unpin.';
        rows.clear();
        const content = document.createDocumentFragment();
        if (!visible.length) {
          const empty = document.createElement('p');
          empty.textContent = ctx.type === 'pause' && !events.length ? 'Events appear here after the first completed turn.' : 'No events in this selection.';
          content.append(empty);
        }
        let currentRound = -1, list;
        for (const event of visible) {
          if (event.round !== currentRound) {
            currentRound = event.round;
            const heading = document.createElement('h3');
            heading.textContent = roundName(rounds[currentRound]);
            list = document.createElement('ol');
            list.className = 'stats-events';
            content.append(heading, list);
          }
          const row = document.createElement('li'), time = document.createElement(ctx.theater ? 'button' : 'span');
          row.classList.toggle('major', STATS_MAJOR.has(event.type));
          row.tabIndex = 0;
          const markRow = () => { preview = [event]; updateMarks(); };
          const unmarkRow = () => {
            if (preview[0] === event) { preview = []; updateMarks(); }
          };
          row.onpointerenter = markRow;
          row.onpointerleave = () => { if (!row.contains(document.activeElement)) unmarkRow(); };
          row.addEventListener('focusin', markRow);
          row.addEventListener('focusout', focus => {
            if (!row.contains(focus.relatedTarget) && !row.matches(':hover')) unmarkRow();
          });
          row.onclick = click => {
            if (!click.target.closest('button')) pin([event]);
          };
          row.onkeydown = key => {
            if (key.target === row && (key.key === 'Enter' || key.key === ' ')) {
              key.preventDefault();
              pin([event]);
            }
          };
          time.className = 'stats-event-time';
          time.textContent = statsEventTime(event, P.DT);
          if (ctx.theater) {
            time.type = 'button';
            time.onclick = () => {
              const th = ctx.theater;
              $('stats-dialog').close();
              th.paused = true;
              seekReplay(event.tick, th, event.turnIndex);
            };
          }
          const entry = document.createElement('span');
          entry.className = 'stats-event-entry';
          entry.append(statsEventLabel(event), event.actor === null ? document.createElement('span') : pill(event.actor));
          if (event.actor === null) entry.lastChild.textContent = names[event.team];
          if (event.target != null) entry.append(gameUi.icon('arrow-narrow-right'), pill(event.target));
          row.append(time, entry);
          rows.set(event, row);
          list.append(row);
        }
        log.replaceChildren(content);
        log.scrollTop = 0;
        updateMarks();
      }
      function inspectMark(pointer) {
        const rect = map.getBoundingClientRect();
        const x = (pointer.clientX - rect.left) * map.width / rect.width;
        const y = mapTop + (pointer.clientY - rect.top) * map.height / rect.height;
        const hitRadius = 12 * map.width / rect.width;
        let closest = null, distance = hitRadius;
        for (const event of visible) {
          const gap = Math.hypot(event.x - x, event.y - y);
          if (gap <= distance) { closest = event; distance = gap; }
        }
        if (closest !== hovered || pointer.type === 'click') {
          hovered = closest;
          preview = closest ? visible.filter(event =>
            Math.hypot(event.x - closest.x, event.y - closest.y) <= radius(event) + radius(closest)
          ) : [];
          detail.textContent = preview.length ? preview.map(event => `${statsEventText(event, names)} · ${statsEventTime(event, P.DT)}`).join('\n') : 'Hover to preview. Click to pin or unpin.';
          if (pointer.type === 'click') {
            pin(preview);
            const row = rows.get(preview[0]);
            if (row) {
              const viewport = log.getBoundingClientRect(), bounds = row.getBoundingClientRect();
              log.scrollTo({ top: log.scrollTop + bounds.top - viewport.top - (log.clientHeight - bounds.height) / 2, behavior: 'smooth' });
            }
          } else {
            updateMarks();
          }
        }
      }
      map.onpointermove = inspectMark;
      map.onclick = inspectMark;
      map.onpointerleave = () => {
        hovered = null;
        preview = [];
        updateMarks();
        detail.textContent = 'Hover to preview. Click to pin or unpin.';
      };
      highlights.onclick = () => { ctx.highlights = !ctx.highlights; updateLog(); };
      for (const [id, key, label] of [['stats-ball-trail', 'ballTrail', 'ball trail'], ['stats-ubu-trails', 'ubuTrails', 'ubu trails']]) {
        const button = $(id);
        const update = () => {
          button.setAttribute('aria-pressed', String(Boolean(ctx[key])));
          button.textContent = `${ctx[key] ? 'Hide' : 'Show'} ${label}`;
        };
        update();
        button.onclick = () => {
          ctx[key] = !ctx[key];
          update();
          drawMap();
        };
      }
      updateLog();
    }

    function renderStats(ctx = activeStatsContext) {
      if (!ctx) return;
      activeStatsContext = ctx;
      updateStatsRinkWidth();

      const s = getStatsForContext(ctx);
      const isGame = ctx.type === 'game';
      const online = getOnline(), scores = getScores(), fieldView = getFieldView();
      const names = [$('home-label').textContent, $('opponent-label').textContent];
      ctx.names = names;
      showStatsTab(ctx);

      $('stats-title').textContent = 'Game stats';
      $('stats-watch-replay').hidden = !isGame || online?.active;

      const honoursEl = $('stats-honours');
      if (isGame && (!online?.active || online.state.game.winner != null)) {
        const { tally: t, scores: sc } = viewTally();
        const w = sc[0] > sc[1] ? 0 : 1;
        const h = ububallMatch.honours(t, sc, w);
        honoursEl.textContent = [h.comeback && 'Comeback from 3 down!', h.shutout && 'Shutout!'].filter(Boolean).join(' ');
        honoursEl.hidden = !honoursEl.textContent;
      } else {
        honoursEl.textContent = '';
        honoursEl.hidden = true;
      }

      let winner = null;
      if (isGame) {
        winner = online?.active
          ? (online.state.winner == null ? null : online.state.winner === online.state.seat ? 0 : 1)
          : (scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1);
      } else if (ctx.theater?.replay?.final) {
        const fin = ctx.theater.replay.final;
        winner = fin.winner == null ? null : (ctx.theater.seat ? 1 - fin.winner : fin.winner);
      } else {
        winner = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : null;
      }

      const mvp = matchMvp(s);

      const table = document.createElement('table'), head = table.createTHead().insertRow();
      const headers = ['', 'Ubu', 'Goals', 'Assists', 'Shots on goal', 'Saves', 'Checks', 'Touches', 'Passes', 'Top shot', 'Distance', 'Fouls'];
      for (const label of headers) {
        const th = document.createElement('th');
        th.textContent = label;
        head.append(th);
      }

      const rows = table.createTBody();
      fieldView.entries.slice(0, 6).forEach((entry, i) => {
        const team = i < 3 ? 0 : 1;
        const isWinner = winner !== null && team === winner;
        const row = rows.insertRow();
        row.className = `team-${team}`;

        const trophyCell = row.insertCell();
        trophyCell.className = `col-trophy${isWinner ? ` team-${team}-win` : ''}`;
        if (isWinner) trophyCell.append(gameUi.icon('trophy'));

        const nameCell = row.insertCell();
        nameCell.className = `col-name team-${team}`;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'ubu-name';
        nameSpan.textContent = entry.model.parts.fullName;
        nameCell.append(nameSpan);
        if (i === mvp) {
          const badge = document.createElement('span');
          badge.className = 'mvp-badge';
          badge.textContent = 'MVP';
          nameCell.append(' ', badge);
        }

        const values = [
          s.goals[i],
          s.assists[i],
          s.shots?.[i] || 0,
          s.saves[i],
          s.checks?.[i] || 0,
          s.touches[i],
          s.passes[i],
          s.topShot[i] ? Math.round(s.topShot[i]) : '–',
          (s.skated[i] / 880).toFixed(1),
          s.cards[i]
        ];
        for (const val of values) {
          row.insertCell().textContent = val;
        }
      });
      $('stats-table').replaceChildren(table);

      const totalControl = s.control[0] + s.control[1] || 1;
      $('stats-control').replaceChildren(...[0, 1].map(team => {
        const part = document.createElement('span');
        part.className = team ? 'away' : 'home';
        part.style.flexGrow = String(s.control[team] || 0.001);
        part.textContent = `${names[team]} ${Math.round(s.control[team] / totalControl * 100)}%`;
        return part;
      }));

      const totalSide = s.side[0] + s.side[1] || 1;
      $('stats-side').replaceChildren(...[0, 1].map(team => {
        const part = document.createElement('span');
        part.className = team ? 'away' : 'home';
        part.style.flexGrow = String(s.side[team] || 0.001);
        part.textContent = `${names[team]} ${Math.round(s.side[team] / totalSide * 100)}%`;
        return part;
      }));

      $('stats-note').textContent = "Top shot is the ball speed off that ubu's fastest touch. Distance is in rink lengths. Shots on goal include goals, saved attempts and high-power strikes off the post. Checks are hard hits inflicting daze or stuns. Fouls are yellow cards.";
    }

    function openMatchStats(type) {
      if (type === 'replay') {
        const th = getTheater();
        if (!th || th.exporting) return;
        th.paused = true;
        th.steps = 0;
        updateReplayBar();
        renderStats({ type: 'replay', theater: th });
      } else {
        const replay = type === 'pause' && getPhase() !== 'over' ? getRecording() : getLastCompletedReplay();
        renderStats({ type, replay });
      }
      if (!$('stats-dialog').open) $('stats-dialog').showModal();
    }

    function openStats() {
      openMatchStats('replay');
    }

    function downloadReplay(file, recorded, title = null) {
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([file], { type: 'application/gzip' })),
        download: `${replayFileName(recorded, title)}.ububall`
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    }

    function replaysNote(problem = '') {
      $('replays-note').textContent = problem || `Your latest ${ububallReplay.KEEP} matches are kept automatically. Pinned and imported replays stay for the current version until you delete them.`;
      $('replays-note').classList.toggle('problem', Boolean(problem));
    }

    async function openReplay(id) {
      if (getOnline()?.active) { replaysNote('Leave your online match to watch a replay.'); return; }
      if (matchInProgress() && !getTheater() && !await gameUi.confirm({ title: 'Watch replay?', message: 'Watching a replay ends your current match.', confirmLabel: 'Watch replay' })) return;
      try {
        const entry = await replayStore.get(id), replay = await ububallReplay.read(entry.file);
        if ($('replays-dialog').open) $('replays-dialog').close();
        if (matchInProgress()) finishCpuMatch();
        closeFirstTurnGuide();
        watchReplay(replay, entry.file);
      } catch (error) { replaysNote(error.message); }
    }

    function iconButton(name, label, run, className = 'icon-button') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.onclick = run;
      button.append(gameUi.icon(name));
      return button;
    }

    // Renaming rewrites the file too, so an export carries the name.
    async function renameReplay(entry, title) {
      const replay = await ububallReplay.read(entry.file);
      await replayStore.put({ ...entry, title, file: await ububallReplay.write({ ...replay, title }) });
    }

    // The library: pinned first, then newest first. Replays from another physics or file version can
    // never play again (see P.VERSION), so they are removed.
    async function openReplays() {
      deletedReplays.length = 0;
      replaysNote();
      if (!$('replays-dialog').open) $('replays-dialog').showModal();
      await listReplays();
    }

    async function listReplays(problem = '') {
      const list = $('replays-list');
      let entries;
      try {
        entries = await replayStore.all();
        const stale = entries.filter(e => e.physics !== P.VERSION || e.format !== ububallReplay.FORMAT);
        if (stale.length) await Promise.all(stale.map(e => replayStore.remove(e.id)));
        entries = entries.filter(e => !stale.includes(e)).sort((a, b) => b.pinned - a.pinned || b.id - a.id);
      } catch { replaysNote('Replays cannot be saved in this browser.'); return; }
      replaysNote(problem);
      const undo = $('replays-undo'), last = deletedReplays.at(-1);
      undo.classList.toggle('idle', !last);
      if (last) undo.querySelector('span').textContent = last.title ? `Deleted “${last.title}”.` : `Deleted a ${last.clip ? 'clip' : 'replay'}.`;
      const empty = Object.assign(document.createElement('li'), { className: 'replays-empty', textContent: 'No replays yet. Matches are saved here automatically.' });
      list.replaceChildren(...(entries.length ? entries.map(replayItem) : [empty]));
    }

    function replayItem(e) {
      const names = e.seat ? [...e.names].reverse() : e.names;
      const sc = e.seat ? [...e.scores].reverse() : e.scores;
      const score = `${names[0]} ${sc[0]}–${sc[1]} ${names[1]}`;
      const item = document.createElement('li'), heading = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('small');
      item.classList.toggle('pinned', Boolean(e.pinned));
      heading.className = 'replay-heading';
      name.textContent = e.title || score;
      meta.textContent = [
        e.title && score,
        e.clip ? 'Clip' : ububallMatch.modeName(e.mode),
        new Date(e.recorded).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        `${e.turns} turn${e.turns === 1 ? '' : 's'}`,
        !e.clip && !e.final && 'Unfinished'
      ].filter(Boolean).join(' · ');
      const pin = iconButton('pin', e.pinned ? 'Unpin' : 'Pin', async () => {
        try { await replayStore.put({ ...e, pinned: !e.pinned }); listReplays(); } catch (error) { replaysNote(error.message); }
      });
      pin.setAttribute('aria-pressed', String(Boolean(e.pinned)));
      const rename = () => {
        const input = Object.assign(document.createElement('input'), { value: e.title || '', maxLength: ububallReplay.MAX_TITLE, placeholder: score, className: 'replay-name' });
        input.setAttribute('aria-label', 'Replay name');
        heading.replaceWith(input); input.focus(); input.select();
        let done = false;
        const finish = async save => {
          if (done) return;
          done = true;
          const title = input.value.trim() || null;
          let message = '';
          try { if (save && title !== e.title) await renameReplay(e, title); } catch (error) { message = error.message; }
          listReplays(message);
        };
        input.onkeydown = event => {
          if (event.key === 'Enter') finish(true);
          else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        };
        input.onblur = () => finish(true);
      };
      // Watch leads the row; the name carries its own small rename button.
      heading.append(name, iconButton('edit', 'Rename', rename, 'icon-button replay-rename'));
      const actions = document.createElement('div');
      actions.className = 'replay-actions';
      actions.append(
        pin,
        iconButton('download', 'Export .ububall', () => downloadReplay(e.file, e.recorded, e.title)),
        iconButton('trash', 'Delete', async () => {
          try { await replayStore.remove(e.id); deletedReplays.push(e); listReplays(); } catch (error) { replaysNote(error.message); }
        })
      );
      item.append(iconButton('play', 'Watch', () => openReplay(e.id), 'icon-button primary replay-watch'), heading, meta, actions);
      return item;
    }

    function bindEvents() {
      $('stats-box-tab').onclick = () => { if (activeStatsContext) { activeStatsContext.tab = 'box'; showStatsTab(activeStatsContext); } };
      $('stats-log-tab').onclick = () => { if (activeStatsContext) { activeStatsContext.tab = 'log'; showStatsTab(activeStatsContext); } };
      $('replay-stats').onclick = openStats;
      $('stats-close').onclick = () => $('stats-dialog').close();
      $('stats-watch-replay').onclick = async () => {
        const id = await getLastSaved();
        if (id) {
          closeSummary();
          openReplay(id);
        }
      };
      $('match-summary').addEventListener('cancel', event => event.preventDefault());
      $('summary-stats').onclick = () => openMatchStats('game');
      $('summary-play-again').onclick = () => {
        closeSummary();
        newMatch(true);
      };
      $('summary-rematch').onclick = () => {
        const online = getOnline();
        if (online?.active) online.rematch();
      };
      $('summary-leave').onclick = async () => {
        const online = getOnline();
        if (online?.active && !await online.leave()) return;
        closeSummary();
        exitMatchMode();
        if (history.state?.match) history.back();
      };
      addEventListener('resize', updateStatsRinkWidth);
      $('replay-exit').onclick = () => { exitMatchMode(); if (history.state?.match) history.back(); };
      // Space plays and pauses and the arrows step by turn, unless a control has focus.
      document.addEventListener('keydown', event => {
        if (!getTheater() || getShot() !== 'replay' || getCameraMove() || document.querySelector('dialog[open]') || event.target.closest?.('button, input, select, textarea')) return;
        const button = { ' ': 'replay-play', ArrowLeft: 'replay-prev', ArrowRight: 'replay-next' }[event.key];
        if (button) { event.preventDefault(); $(button).click(); }
      });
      $('replays-undo').append(iconButton('undo', 'Undo delete', async () => {
        const entry = deletedReplays.at(-1);
        if (!entry) return;
        try {
          await replayStore.put(entry);
          deletedReplays.pop();
          listReplays();
        } catch (error) { replaysNote(error.message); }
      }, 'quiet'));
      $('replays-undo').lastChild.append('Undo');
      // Imported replays are checked like any other and stay until deleted.
      $('replays-import').onchange = async event => {
        const files = [...event.target.files], problems = [];
        event.target.value = '';
        for (const file of files) {
          try {
            if (file.size > 8 << 20) throw new Error('This replay is too large.');
            const bytes = new Uint8Array(await file.arrayBuffer());
            await replayStore.add(libraryEntry(await ububallReplay.read(bytes), bytes, false));
          } catch (error) { problems.push(`${file.name}: ${error.message}`); }
        }
        listReplays(problems.join(' '));
      };
      $('replays-open').onclick = openReplays;
      $('replays-close').onclick = () => $('replays-dialog').close();
    }

    return {
      replayStats,
      updateStatsRinkWidth,
      getStatsForContext,
      showStatsTab,
      renderGameLog,
      renderStats,
      openMatchStats,
      openStats,
      downloadReplay,
      openReplay,
      openReplays,
      listReplays,
      bindEvents
    };
  }

  const api = {
    STATS_MAJOR,
    matchMvp,
    statsEventLabel,
    statsEventTime,
    replayFileName,
    createStatsController
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
