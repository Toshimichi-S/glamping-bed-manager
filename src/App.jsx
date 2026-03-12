import { useState, useRef, useEffect, useCallback } from "react";

// ─── 初期データ ───────────────────────────────────────────────
const INITIAL_TENTS = [
  { id: "t1", name: "1棟", x: 180, y: 120, guests: 2, mainBeds: 2, extraBeds: 1 },
  { id: "t2", name: "2棟", x: 380, y: 90,  guests: 4, mainBeds: 2, extraBeds: 0 },
  { id: "t3", name: "3棟", x: 560, y: 160, guests: 1, mainBeds: 2, extraBeds: 6 },
  { id: "t4", name: "4棟", x: 150, y: 300, guests: 5, mainBeds: 2, extraBeds: 0 },
  { id: "t5", name: "5棟", x: 360, y: 280, guests: 3, mainBeds: 2, extraBeds: 1 },
  { id: "t6", name: "6棟", x: 590, y: 310, guests: 2, mainBeds: 2, extraBeds: 0 },
  { id: "t7", name: "7棟", x: 240, y: 440, guests: 6, mainBeds: 2, extraBeds: 0 },
  { id: "t8", name: "8棟", x: 500, y: 430, guests: 2, mainBeds: 2, extraBeds: 2 },
];

const INITIAL_WAYPOINTS = [
  { id: "w1", x: 300, y: 110 },
  { id: "w2", x: 300, y: 200 },
  { id: "w3", x: 300, y: 320 },
  { id: "w4", x: 420, y: 320 },
  { id: "w5", x: 420, y: 430 },
];

const INITIAL_EDGES = [
  ["t1","w1"],["w1","t2"],["w1","w2"],["w2","t3"],
  ["w2","t5"],["w2","w3"],["w3","t4"],["w3","w4"],
  ["w4","t6"],["w4","w5"],["w5","t7"],["w5","t8"],
];

const INITIAL_STAFF = ["スタッフA", "スタッフB", "スタッフC"];

const STORAGE_KEY = "bedflow_v3";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveState(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// ─── ダイクストラ ─────────────────────────────────────────────
function euclidean(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function dijkstra(startId, allNodes, edges) {
  const dist = {}, prev = {}, visited = new Set();
  allNodes.forEach(n => { dist[n.id] = Infinity; prev[n.id] = null; });
  dist[startId] = 0;
  const adj = {};
  allNodes.forEach(n => (adj[n.id] = []));
  edges.forEach(([a, b]) => {
    const na = allNodes.find(n => n.id === a);
    const nb = allNodes.find(n => n.id === b);
    if (!na || !nb) return;
    const d = euclidean(na, nb);
    adj[a].push({ id: b, d }); adj[b].push({ id: a, d });
  });
  while (true) {
    let u = null;
    allNodes.forEach(n => { if (!visited.has(n.id) && (u === null || dist[n.id] < dist[u])) u = n.id; });
    if (u === null || dist[u] === Infinity) break;
    visited.add(u);
    for (const { id: v, d } of adj[u]) {
      if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; }
    }
  }
  return { dist, prev };
}
function getPath(prev, targetId) {
  const path = []; let cur = targetId;
  while (cur !== null) { path.unshift(cur); cur = prev[cur]; }
  return path;
}

// ─── 輸送最適化 ───────────────────────────────────────────────
function solveTransport(tents, waypoints, edges) {
  const allNodes = [
    ...tents.map(t => ({ id: t.id, x: t.x, y: t.y })),
    ...waypoints.map(w => ({ id: w.id, x: w.x, y: w.y })),
  ];
  const states = tents.map(t => {
    const need = Math.max(0, t.guests - (t.mainBeds ?? 2));
    const deficit = need - t.extraBeds;
    return { ...t, need, deficit };
  });
  const surplusPool = states.filter(s => s.deficit < 0).map(s => ({ ...s, available: -s.deficit }));
  const deficitPool = states.filter(s => s.deficit > 0).map(s => ({ ...s, required: s.deficit }));
  const distCache = {}, pathCache = {};
  tents.forEach(t => {
    const { dist, prev } = dijkstra(t.id, allNodes, edges);
    distCache[t.id] = dist; pathCache[t.id] = prev;
  });
  const candidates = [];
  for (const d of deficitPool)
    for (const s of surplusPool)
      candidates.push({ from: s.id, to: d.id, dist: distCache[s.id][d.id], path: getPath(pathCache[s.id], d.id) });
  candidates.sort((a, b) => a.dist - b.dist);
  const remaining = {}, required = {};
  surplusPool.forEach(s => (remaining[s.id] = s.available));
  deficitPool.forEach(d => (required[d.id] = d.required));
  const moves = [];
  for (const c of candidates) {
    const canSend = remaining[c.from] || 0, needRecv = required[c.to] || 0;
    if (canSend <= 0 || needRecv <= 0) continue;
    const qty = Math.min(canSend, needRecv);
    moves.push({ ...c, qty, cost: qty * c.dist });
    remaining[c.from] -= qty; required[c.to] -= qty;
  }
  return { states, moves, totalCost: moves.reduce((s, m) => s + m.cost, 0) };
}

function statusColor(deficit) {
  if (deficit > 0) return "#c0392b";
  if (deficit < 0) return "#27ae60";
  return "#5a6e5a";
}
function statusLabel(deficit) {
  if (deficit > 0) return `不足 ${deficit}`;
  if (deficit < 0) return `余剰 ${-deficit}`;
  return "過不足なし";
}
function svgPt(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// ─── STAFF COLORS ─────────────────────────────────────────────
const STAFF_PALETTE = ["#3498db","#e67e22","#9b59b6","#1abc9c","#e74c3c","#f39c12"];

// ─── APP ──────────────────────────────────────────────────────
export default function App() {
  const saved = loadState();
  const [tents, setTents]         = useState(saved?.tents || INITIAL_TENTS);
  const [waypoints, setWaypoints] = useState(saved?.waypoints || INITIAL_WAYPOINTS);
  const [edges, setEdges]         = useState(saved?.edges || INITIAL_EDGES);
  const [staff, setStaff]         = useState(saved?.staff || INITIAL_STAFF);
  // taskState: { [moveKey]: { assignee: string|null, done: bool } }
  const [taskState, setTaskState] = useState(saved?.taskState || {});
  const [mode, setMode]           = useState("move");
  const [edgeStart, setEdgeStart] = useState(null);
  const [dragging, setDragging]   = useState(null);
  const [selectedTent, setSelectedTent] = useState(null);
  const [showMoves, setShowMoves] = useState(true);
  const [showPath, setShowPath]   = useState(true);
  const [savedMsg, setSavedMsg]   = useState(false);
  const [activeTab, setActiveTab] = useState("tasks"); // tasks | map | tents
  const [editingStaff, setEditingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const svgRef = useRef(null);

  const { states, moves, totalCost } = solveTransport(tents, waypoints, edges);

  // moveKey: stable ID based on from+to
  const getMoveKey = (m) => `${m.from}_${m.to}`;

  const getTask = (m) => taskState[getMoveKey(m)] || { assignee: null, done: false };
  const setTask = (m, patch) => setTaskState(prev => ({
    ...prev, [getMoveKey(m)]: { ...getTask(m), ...patch }
  }));

  const doneMoves = moves.filter(m => getTask(m).done).length;
  const totalMoves = moves.length;

  const allNodes = [
    ...tents.map(t => ({ id: t.id, x: t.x, y: t.y })),
    ...waypoints.map(w => ({ id: w.id, x: w.x, y: w.y })),
  ];
  const getNodePos = id => allNodes.find(n => n.id === id);

  const handleSave = () => {
    saveState({ tents, waypoints, edges, staff, taskState });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };
  const handleReset = () => {
    if (!window.confirm("全データを初期化しますか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    setTents(INITIAL_TENTS); setWaypoints(INITIAL_WAYPOINTS);
    setEdges(INITIAL_EDGES); setStaff(INITIAL_STAFF); setTaskState({});
  };

  // ── ノード操作 ──
  const onNodeMouseDown = (e, id, type) => {
    e.stopPropagation();
    if (mode === "move") {
      setDragging({ id, type });
      if (type === "tent") setSelectedTent(id);
    } else if (mode === "addEdge") {
      if (!edgeStart) { setEdgeStart(id); }
      else {
        if (edgeStart !== id) {
          const exists = edges.some(([a,b]) => (a===edgeStart&&b===id)||(a===id&&b===edgeStart));
          if (!exists) setEdges(prev => [...prev, [edgeStart, id]]);
        }
        setEdgeStart(null);
      }
    } else if (mode === "delete" && type === "waypoint") {
      setWaypoints(prev => prev.filter(w => w.id !== id));
      setEdges(prev => prev.filter(([a,b]) => a !== id && b !== id));
    }
  };
  const onEdgeClick = (e, a, b) => {
    e.stopPropagation();
    if (mode === "delete")
      setEdges(prev => prev.filter(([ea,eb]) => !(ea===a&&eb===b) && !(ea===b&&eb===a)));
  };
  const handleMouseMove = useCallback((e) => {
    if (!dragging || !svgRef.current) return;
    const p = svgPt(svgRef.current, e);
    const x = Math.max(30, Math.min(710, p.x)), y = Math.max(30, Math.min(500, p.y));
    if (dragging.type === "tent") setTents(prev => prev.map(t => t.id === dragging.id ? {...t,x,y} : t));
    else setWaypoints(prev => prev.map(w => w.id === dragging.id ? {...w,x,y} : w));
  }, [dragging]);
  const handleMouseUp = () => setDragging(null);
  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
  }, [handleMouseMove]);
  const onSvgClick = (e) => {
    if (mode !== "addWaypoint" || e.target !== svgRef.current) return;
    const p = svgPt(svgRef.current, e);
    setWaypoints(prev => [...prev, { id: `w${Date.now()}`, x: p.x, y: p.y }]);
  };
  const updateTent = (id, field, val) =>
    setTents(prev => prev.map(t => t.id === id ? {...t, [field]: Math.max(0, Number(val))} : t));

  const sel = selectedTent ? tents.find(t => t.id === selectedTent) : null;
  const selState = selectedTent ? states.find(s => s.id === selectedTent) : null;
  const movePolylines = moves.map(m => ({ ...m, pts: m.path.map(id => getNodePos(id)).filter(Boolean) }));

  const modeColors = { move:"#4a7c59", addWaypoint:"#2980b9", addEdge:"#e8b84b", delete:"#c0392b" };

  // スタッフ別の集計
  const staffSummary = staff.map((s, si) => ({
    name: s,
    color: STAFF_PALETTE[si % STAFF_PALETTE.length],
    total: moves.filter(m => getTask(m).assignee === s).length,
    done:  moves.filter(m => getTask(m).assignee === s && getTask(m).done).length,
  }));

  return (
    <div style={S.root}>
      {/* ── ヘッダー ── */}
      <header style={S.header}>
        <div style={S.headerInner}>
          <div>
            <div style={S.logo}>⛺ BedFlow</div>
            <div style={S.subtitle}>グランピング エクストラベッド最適配置システム</div>
          </div>

          {/* 進捗バー */}
          <div style={S.progressWrap}>
            <div style={S.progressTop}>
              <span style={S.progressLabel}>本日の進捗</span>
              <span style={S.progressFrac}>{doneMoves} / {totalMoves} 完了</span>
            </div>
            <div style={S.progressBar}>
              <div style={{...S.progressFill, width: totalMoves ? `${(doneMoves/totalMoves)*100}%` : "0%"}}/>
            </div>
          </div>

          <div style={S.headerRight}>
            <div style={S.headerStats}>
              <Stat label="総コスト" value={totalCost.toFixed(0)} unit="m" accent />
              <Stat label="作業数" value={totalMoves} unit="件" />
              <Stat label="未着手" value={moves.filter(m=>!getTask(m).assignee&&!getTask(m).done).length} unit="件" warn />
              <Stat label="不足棟" value={states.filter(s=>s.deficit>0).length} unit="棟" warn={states.some(s=>s.deficit>0)} />
            </div>
            <div style={S.saveGroup}>
              <button style={S.saveBtn} onClick={handleSave}>{savedMsg?"✅ 保存済み":"💾 保存"}</button>
              <button style={S.resetBtn} onClick={handleReset}>↩ リセット</button>
            </div>
          </div>
        </div>
      </header>

      {/* ── タブナビ ── */}
      <div style={S.tabBar}>
        {[["tasks","📋 作業プラン"],["map","🗺 施設マップ"],["tents","🛖 棟設定"]].map(([t,l])=>(
          <button key={t} style={{...S.tab,...(activeTab===t?S.tabActive:{})}} onClick={()=>setActiveTab(t)}>{l}</button>
        ))}
      </div>

      <div style={S.body}>
        {/* ════════ タブ: 作業プラン ════════ */}
        {activeTab==="tasks" && (
          <div style={S.tasksLayout}>
            {/* スタッフ列 */}
            <div style={S.staffColumns}>
              {/* 未アサイン列 */}
              <div style={S.staffCol}>
                <div style={{...S.staffColHeader, borderColor:"#5a6e5a"}}>
                  <span style={S.staffColTitle}>未アサイン</span>
                  <span style={S.staffColCount}>{moves.filter(m=>!getTask(m).assignee).length}件</span>
                </div>
                {moves.filter(m=>!getTask(m).assignee).length===0 ? (
                  <div style={S.emptyCol}>✅ 全員アサイン済み</div>
                ) : moves.filter(m=>!getTask(m).assignee).map((m,i)=>(
                  <TaskCard key={i} m={m} task={getTask(m)} tents={tents} staff={staff}
                    staffPalette={STAFF_PALETTE} onAssign={v=>setTask(m,{assignee:v})}
                    onToggleDone={()=>setTask(m,{done:!getTask(m).done})} />
                ))}
              </div>

              {/* スタッフ別列 */}
              {staff.map((s,si)=>{
                const color = STAFF_PALETTE[si % STAFF_PALETTE.length];
                const myMoves = moves.filter(m=>getTask(m).assignee===s);
                const myDone = myMoves.filter(m=>getTask(m).done).length;
                return (
                  <div key={s} style={S.staffCol}>
                    <div style={{...S.staffColHeader, borderColor:color}}>
                      <div style={S.staffColTitleRow}>
                        <span style={{...S.staffDot, background:color}}/>
                        <span style={S.staffColTitle}>{s}</span>
                      </div>
                      <span style={S.staffColCount}>{myDone}/{myMoves.length}完了</span>
                    </div>
                    {/* ミニ進捗バー */}
                    <div style={S.miniBar}>
                      <div style={{...S.miniBarFill, background:color,
                        width: myMoves.length ? `${(myDone/myMoves.length)*100}%` : "0%"}}/>
                    </div>
                    {myMoves.length===0 ? (
                      <div style={S.emptyCol}>作業なし</div>
                    ) : myMoves.map((m,i)=>(
                      <TaskCard key={i} m={m} task={getTask(m)} tents={tents} staff={staff}
                        staffPalette={STAFF_PALETTE} color={color}
                        onAssign={v=>setTask(m,{assignee:v})}
                        onToggleDone={()=>setTask(m,{done:!getTask(m).done})} />
                    ))}
                  </div>
                );
              })}
            </div>

            {/* スタッフ管理パネル */}
            <div style={S.staffMgmt}>
              <div style={S.staffMgmtTitle}>👥 スタッフ管理</div>
              {staff.map((s,si)=>{
                const color = STAFF_PALETTE[si % STAFF_PALETTE.length];
                const sum = staffSummary[si];
                return (
                  <div key={s} style={S.staffRow}>
                    <span style={{...S.staffDot, background:color}}/>
                    <span style={S.staffRowName}>{s}</span>
                    <span style={S.staffRowStat}>{sum.done}/{sum.total}</span>
                    <button style={S.staffDelBtn}
                      onClick={()=>{ if(window.confirm(`${s}を削除しますか？`)) setStaff(prev=>prev.filter(x=>x!==s)); }}>
                      ✕
                    </button>
                  </div>
                );
              })}
              {editingStaff ? (
                <div style={S.addStaffRow}>
                  <input style={S.staffInput} value={newStaffName}
                    onChange={e=>setNewStaffName(e.target.value)}
                    onKeyDown={e=>{
                      if(e.key==="Enter"&&newStaffName.trim()){
                        setStaff(prev=>[...prev,newStaffName.trim()]);
                        setNewStaffName(""); setEditingStaff(false);
                      }
                    }}
                    placeholder="名前を入力 + Enter" autoFocus/>
                  <button style={S.staffCancelBtn} onClick={()=>{setEditingStaff(false);setNewStaffName("");}}>✕</button>
                </div>
              ) : (
                <button style={S.addStaffBtn} onClick={()=>setEditingStaff(true)}>＋ スタッフ追加</button>
              )}

              {/* 凡例 */}
              <div style={S.taskLegend}>
                <div style={S.taskLegendTitle}>ステータス凡例</div>
                <div style={S.taskLegendRow}><span style={{...S.taskLegendDot,background:"#1a3a1a"}}/>未着手</div>
                <div style={S.taskLegendRow}><span style={{...S.taskLegendDot,background:"#2a3a1a"}}/>アサイン済み</div>
                <div style={S.taskLegendRow}><span style={{...S.taskLegendDot,background:"#1a2a1a",border:"1px solid #27ae60"}}/>完了</div>
              </div>
            </div>
          </div>
        )}

        {/* ════════ タブ: 施設マップ ════════ */}
        {activeTab==="map" && (
          <div style={S.mapArea}>
            <div style={S.toolbar}>
              <div style={S.modeButtons}>
                {[["move","🖱 移動"],["addWaypoint","➕ 交差点"],["addEdge","🔗 通路接続"],["delete","🗑 削除"]].map(([m,l])=>(
                  <button key={m}
                    style={{...S.modeBtn,...(mode===m?{background:modeColors[m],color:"#fff",borderColor:modeColors[m]}:{})}}
                    onClick={()=>{setMode(m);setEdgeStart(null);}}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={S.toggleGroup}>
                <label style={S.toggle}><input type="checkbox" checked={showMoves} onChange={e=>setShowMoves(e.target.checked)}/><span style={S.toggleLabel}>移動指示</span></label>
                <label style={S.toggle}><input type="checkbox" checked={showPath} onChange={e=>setShowPath(e.target.checked)}/><span style={S.toggleLabel}>経路表示</span></label>
              </div>
            </div>
            <div style={{...S.modeHint, borderColor:modeColors[mode], color:modeColors[mode]}}>
              {mode==="move"        && "棟・交差点をドラッグして位置を調整"}
              {mode==="addWaypoint" && "空白をクリックして交差点を追加"}
              {mode==="addEdge"     && (edgeStart ? `接続元選択中 → 次のノードをクリック` : "2つのノードを順にクリックして通路を接続")}
              {mode==="delete"      && "交差点または通路エッジをクリックして削除"}
            </div>
            <svg ref={svgRef} style={S.svg} viewBox="0 0 740 530"
              preserveAspectRatio="xMidYMid meet"
              onClick={onSvgClick}
              cursor={mode==="addWaypoint"?"crosshair":"default"}>
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#3d4a3e" strokeWidth="0.5" opacity="0.4"/>
                </pattern>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#e8b84b"/>
                </marker>
                <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/>
                  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              </defs>
              <rect width="740" height="530" fill="#1a2b1c" rx="12"/>
              <rect width="740" height="530" fill="url(#grid)" rx="12"/>

              {edges.map(([a,b],i)=>{
                const na=getNodePos(a),nb=getNodePos(b);
                if(!na||!nb)return null;
                const isDel=mode==="delete";
                return <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke={isDel?"#7f4040":"#3a5c3d"} strokeWidth={isDel?5:2.5}
                  strokeDasharray={isDel?"none":"5 3"}
                  style={{cursor:isDel?"pointer":"default"}} onClick={e=>onEdgeClick(e,a,b)}/>;
              })}

              {mode==="addEdge"&&edgeStart&&(()=>{
                const s=getNodePos(edgeStart);
                return s?<circle cx={s.x} cy={s.y} r="22" fill="none" stroke="#e8b84b" strokeWidth="2.5" strokeDasharray="4 2" opacity="0.8"/>:null;
              })()}

              {/* 移動経路（担当者色） */}
              {showMoves&&showPath&&movePolylines.map((m,i)=>{
                if(m.pts.length<2)return null;
                const task=getTask(m);
                const si=staff.indexOf(task.assignee);
                const color = si>=0 ? STAFF_PALETTE[si%STAFF_PALETTE.length] : "#e8b84b";
                const pts=m.pts.map(p=>`${p.x},${p.y}`).join(" ");
                const last=m.pts[m.pts.length-1],p2=m.pts[m.pts.length-2];
                const dx=last.x-p2.x,dy=last.y-p2.y,len=Math.sqrt(dx*dx+dy*dy);
                const nx=dx/len,ny=dy/len,r=28;
                const mid=m.pts[Math.floor(m.pts.length/2)];
                return (
                  <g key={i}>
                    <polyline points={pts} fill="none" stroke={color}
                      strokeWidth={task.done?1.5:2.5}
                      strokeDasharray={task.done?"4 4":"6 3"} opacity={task.done?0.4:0.9}/>
                    <line x1={last.x-nx*r*1.5} y1={last.y-ny*r*1.5}
                      x2={last.x-nx*r} y2={last.y-ny*r}
                      stroke={color} strokeWidth="2.5" markerEnd="url(#arrow)" opacity={task.done?0.4:0.9}/>
                    <circle cx={mid.x} cy={mid.y} r="13" fill={color} opacity={task.done?0.5:1}/>
                    <text x={mid.x} y={mid.y+4} textAnchor="middle"
                      style={{fontSize:10,fontWeight:"bold",fill:"#fff",fontFamily:"monospace"}}>
                      {task.done?"✓":m.qty}
                    </text>
                  </g>
                );
              })}

              {waypoints.map(w=>(
                <g key={w.id} transform={`translate(${w.x},${w.y})`}
                  style={{cursor:mode==="move"?"grab":"pointer"}}
                  onMouseDown={e=>onNodeMouseDown(e,w.id,"waypoint")}>
                  <circle r="9" fill="#1e3020" stroke={edgeStart===w.id?"#e8b84b":mode==="delete"?"#c0392b":"#4a7c59"} strokeWidth={edgeStart===w.id?3:1.5}/>
                  <circle r="3" fill={mode==="delete"?"#c0392b":"#7ba880"}/>
                </g>
              ))}

              {tents.map(t=>{
                const st=states.find(s=>s.id===t.id);
                const col=statusColor(st.deficit);
                const isSel=selectedTent===t.id;
                return (
                  <g key={t.id} transform={`translate(${t.x},${t.y})`}
                    style={{cursor:mode==="move"?"grab":"pointer"}}
                    onMouseDown={e=>onNodeMouseDown(e,t.id,"tent")}>
                    {isSel&&<circle r="34" fill={col} opacity="0.18" filter="url(#glow)"/>}
                    <circle r="26" fill="#243526" stroke={edgeStart===t.id?"#e8b84b":col} strokeWidth={isSel||edgeStart===t.id?3:2}/>
                    <text y="-7" textAnchor="middle" style={{fontSize:18,fill:"#f0e6d0",fontFamily:"serif",pointerEvents:"none"}}>⛺</text>
                    <text y="7" textAnchor="middle" style={{fontSize:10,fontWeight:"bold",fill:"#f0e6d0",fontFamily:"monospace",pointerEvents:"none"}}>{t.name}</text>
                    <g transform="translate(14,-14)">
                      <circle r="10" fill={col}/>
                      <text y="4" textAnchor="middle" style={{fontSize:10,fontWeight:"bold",fill:"#fff",fontFamily:"monospace",pointerEvents:"none"}}>{t.extraBeds}</text>
                    </g>
                    <text y="40" textAnchor="middle" style={{fontSize:9.5,fill:"#8fb893",fontFamily:"monospace",pointerEvents:"none"}}>{t.guests}名/{st.need}床必要</text>
                  </g>
                );
              })}
            </svg>
            <div style={S.legend}>
              {[["#c0392b","不足"],["#27ae60","余剰"],["#5a6e5a","ちょうど"],["#4a7c59","交差点"],["#e8b84b","移動（未アサイン）"]].map(([c,l])=>(
                <span key={l} style={S.legendItem}><span style={{...S.legendDot,background:c}}/>{l}</span>
              ))}
              {staff.map((s,si)=>(
                <span key={s} style={S.legendItem}>
                  <span style={{...S.legendDot,background:STAFF_PALETTE[si%STAFF_PALETTE.length]}}/>
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ════════ タブ: 棟設定 ════════ */}
        {activeTab==="tents" && (
          <div style={S.tentsGrid}>
            {tents.map(t=>{
              const st=states.find(s=>s.id===t.id);
              return (
                <div key={t.id} style={{...S.tentBigCard, borderColor:statusColor(st.deficit)}}>
                  <div style={S.tentBigHeader}>
                    <span style={S.tentBigName}>{t.name}</span>
                    <span style={{...S.badge, background:statusColor(st.deficit), fontSize:11, padding:"3px 8px"}}>
                      {statusLabel(st.deficit)}
                    </span>
                  </div>
                  <div style={S.tentBigRow}>
                    <Field label="宿泊人数" value={t.guests} min={0} max={12} onChange={v=>updateTent(t.id,"guests",v)}/>
                    <Field label="メインベッド" value={t.mainBeds??2} min={0} max={6} onChange={v=>updateTent(t.id,"mainBeds",v)}/>
                    <Field label="保有エクストラ" value={t.extraBeds} min={0} max={8} onChange={v=>updateTent(t.id,"extraBeds",v)}/>
                  </div>
                  <div style={S.bedViz}>
                    {[...Array(t.mainBeds??2)].map((_,i)=><BedIcon key={`m${i}`} type="main" label="M"/>)}
                    {[...Array(t.extraBeds)].map((_,i)=><BedIcon key={`e${i}`} type="extra" label="E"/>)}
                    {st.deficit>0&&[...Array(st.deficit)].map((_,i)=><BedIcon key={`x${i}`} type="missing" label="?"/>)}
                  </div>
                  <div style={S.tentBigStats}>
                    <span>必要エクストラ: <strong style={{color:"#f0e6d0"}}>{st.need}床</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TaskCard ──────────────────────────────────────────────────
function TaskCard({ m, task, tents, staff, staffPalette, color, onAssign, onToggleDone }) {
  const from = tents.find(t=>t.id===m.from);
  const to   = tents.find(t=>t.id===m.to);
  return (
    <div style={{
      ...S.taskCard,
      ...(task.done ? S.taskCardDone : {}),
      borderLeft: `3px solid ${color||"#5a6e5a"}`,
    }}>
      <div style={S.taskCardTop}>
        <div style={S.taskRoute}>
          <span style={S.taskFrom}>{from?.name}</span>
          <span style={S.taskArrow}>→</span>
          <span style={S.taskTo}>{to?.name}</span>
          <span style={S.taskQty}>🛏×{m.qty}</span>
        </div>
        <button
          style={{...S.doneBtn, ...(task.done?S.doneBtnActive:{})}}
          onClick={onToggleDone}
          title={task.done?"未完了に戻す":"完了にする"}>
          {task.done ? "✓" : "○"}
        </button>
      </div>
      <div style={S.taskDist}>
        {m.dist===Infinity?"⚠️ 経路なし":`距離 ${m.dist.toFixed(0)}m`}
      </div>
      <select
        style={{
          ...S.assignSelect,
          ...(task.assignee ? {borderColor: staffPalette[staff.indexOf(task.assignee)%staffPalette.length], color:"#f0e6d0"} : {})
        }}
        value={task.assignee||""}
        onChange={e=>onAssign(e.target.value||null)}>
        <option value="">-- 担当者を選択 --</option>
        {staff.map(s=><option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function Field({ label, value, min, max, onChange }) {
  return (
    <div style={S.field}>
      <div style={S.fieldLabel}>{label}</div>
      <div style={S.fieldControls}>
        <button style={S.btn} onClick={()=>onChange(Math.max(min,value-1))}>−</button>
        <span style={S.fieldVal}>{value}</span>
        <button style={S.btn} onClick={()=>onChange(Math.min(max,value+1))}>＋</button>
      </div>
    </div>
  );
}
function BedIcon({ type, label }) {
  const colors={main:"#2d5c3a",extra:"#7a6020",missing:"#5c2020"};
  const tc={main:"#7ba880",extra:"#c8a85e",missing:"#c07070"};
  return (
    <div style={{...S.bedIcon,background:colors[type],border:`1px solid ${tc[type]}`}}>
      <span style={{fontSize:8,color:tc[type]}}>{label}</span>
    </div>
  );
}
function Stat({ label, value, unit, accent, warn }) {
  return (
    <div style={{...S.stat,...(accent?S.statAccent:{}),...(warn&&Number(value)>0?S.statWarn:{})}}>
      <div style={S.statVal}>{value}<span style={S.statUnit}>{unit}</span></div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

// ─── スタイル ─────────────────────────────────────────────────
const S = {
  root:{minHeight:"100vh",background:"#0f1a10",color:"#e8e0d0",fontFamily:"'Georgia',serif",display:"flex",flexDirection:"column"},
  header:{background:"linear-gradient(135deg,#162318 0%,#1e3020 100%)",borderBottom:"2px solid #2d4a30",padding:"12px 20px"},
  headerInner:{display:"flex",alignItems:"center",gap:20,maxWidth:1600,margin:"0 auto",width:"100%"},
  logo:{fontSize:20,fontWeight:"bold",color:"#c8a85e",letterSpacing:1},
  subtitle:{fontSize:10,color:"#6a9a70",marginTop:1,letterSpacing:0.5},
  progressWrap:{flex:1,minWidth:160,maxWidth:240},
  progressTop:{display:"flex",justifyContent:"space-between",marginBottom:4},
  progressLabel:{fontSize:10,color:"#7ba880"},
  progressFrac:{fontSize:11,fontWeight:"bold",color:"#c8a85e"},
  progressBar:{height:6,background:"#1a2b1c",borderRadius:3,overflow:"hidden"},
  progressFill:{height:"100%",background:"linear-gradient(90deg,#27ae60,#2ecc71)",borderRadius:3,transition:"width .5s"},
  headerRight:{display:"flex",gap:12,alignItems:"center"},
  headerStats:{display:"flex",gap:8},
  stat:{background:"#162318",border:"1px solid #2d4a30",borderRadius:6,padding:"6px 10px",textAlign:"center",minWidth:64},
  statAccent:{border:"1px solid #c8a85e",background:"#1e1a0a"},
  statWarn:{border:"1px solid #7a3030"},
  statVal:{fontSize:18,fontWeight:"bold",color:"#f0e6d0",lineHeight:1},
  statUnit:{fontSize:10,color:"#8fa890",marginLeft:2},
  statLabel:{fontSize:9,color:"#6a8a70",marginTop:2},
  saveGroup:{display:"flex",gap:4},
  saveBtn:{background:"#1e3020",border:"1px solid #4a7c59",color:"#c8a85e",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:"bold"},
  resetBtn:{background:"#1e1a1a",border:"1px solid #4a3030",color:"#8a7070",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11},

  tabBar:{display:"flex",background:"#111a12",borderBottom:"1px solid #2d4a30",padding:"0 20px"},
  tab:{background:"transparent",border:"none",borderBottom:"2px solid transparent",color:"#6a8a70",padding:"10px 18px",cursor:"pointer",fontSize:13,fontFamily:"inherit",transition:"all .15s"},
  tabActive:{borderBottomColor:"#c8a85e",color:"#c8a85e"},

  body:{flex:1,overflow:"hidden",display:"flex"},

  // ── 作業プラン ──
  tasksLayout:{display:"flex",flex:1,overflow:"hidden",gap:0},
  staffColumns:{display:"flex",flex:1,gap:0,overflowX:"auto",padding:"12px 16px",gap:10},
  staffCol:{minWidth:220,maxWidth:280,flex:"0 0 240px",display:"flex",flexDirection:"column",gap:6},
  staffColHeader:{background:"#162318",border:"1px solid #2d4a30",borderTop:"3px solid",borderRadius:"6px 6px 0 0",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"},
  staffColTitleRow:{display:"flex",alignItems:"center",gap:6},
  staffColTitle:{fontSize:12,fontWeight:"bold",color:"#f0e6d0"},
  staffColCount:{fontSize:10,color:"#8fa890",background:"#1a2b1c",borderRadius:4,padding:"2px 6px"},
  miniBar:{height:3,background:"#1a2b1c",borderRadius:2,margin:"0 0 6px",overflow:"hidden"},
  miniBarFill:{height:"100%",borderRadius:2,transition:"width .4s"},
  emptyCol:{fontSize:11,color:"#4a6a4a",textAlign:"center",padding:"16px",fontStyle:"italic"},

  taskCard:{background:"#162318",border:"1px solid #2d4a30",borderRadius:8,padding:"10px 12px",cursor:"default",transition:"opacity .2s"},
  taskCardDone:{opacity:0.55},
  taskCardTop:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4},
  taskRoute:{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"},
  taskFrom:{fontSize:12,fontWeight:"bold",color:"#27ae60"},
  taskArrow:{color:"#e8b84b",fontSize:13},
  taskTo:{fontSize:12,fontWeight:"bold",color:"#c0392b"},
  taskQty:{fontSize:10,background:"#e8b84b1a",color:"#e8b84b",borderRadius:4,padding:"1px 5px",marginLeft:2},
  taskDist:{fontSize:10,color:"#5a8a60",marginBottom:6},
  doneBtn:{width:26,height:26,borderRadius:"50%",border:"1px solid #3a5a3a",background:"#1a2b1a",color:"#5a8a60",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},
  doneBtnActive:{background:"#1a4a2a",borderColor:"#27ae60",color:"#27ae60"},
  assignSelect:{width:"100%",background:"#1a2b1c",border:"1px solid #2d4a30",color:"#8fa890",borderRadius:5,padding:"4px 6px",fontSize:11,fontFamily:"inherit",outline:"none",cursor:"pointer"},

  staffMgmt:{width:180,background:"#111a12",borderLeft:"1px solid #2d4a30",padding:"14px 12px",flexShrink:0,overflowY:"auto"},
  staffMgmtTitle:{fontSize:11,letterSpacing:2,color:"#6a8a70",textTransform:"uppercase",marginBottom:12},
  staffRow:{display:"flex",alignItems:"center",gap:6,marginBottom:8},
  staffDot:{width:8,height:8,borderRadius:"50%",flexShrink:0},
  staffRowName:{flex:1,fontSize:12,color:"#d0c8b8"},
  staffRowStat:{fontSize:10,color:"#6a8a70"},
  staffDelBtn:{background:"transparent",border:"none",color:"#6a4a4a",cursor:"pointer",fontSize:11,padding:"2px 4px"},
  addStaffRow:{display:"flex",gap:4,marginTop:8},
  staffInput:{flex:1,background:"#162318",border:"1px solid #3a5a3a",color:"#f0e6d0",borderRadius:5,padding:"4px 6px",fontSize:11,fontFamily:"inherit",outline:"none"},
  staffCancelBtn:{background:"transparent",border:"none",color:"#6a4a4a",cursor:"pointer",fontSize:13},
  addStaffBtn:{background:"#1a2b1c",border:"1px dashed #3a5a3a",color:"#6a8a70",borderRadius:6,padding:"6px",cursor:"pointer",fontSize:11,width:"100%",marginTop:8},
  taskLegend:{marginTop:20,borderTop:"1px solid #2d4a30",paddingTop:12},
  taskLegendTitle:{fontSize:10,color:"#4a6a4a",marginBottom:8,letterSpacing:1},
  taskLegendRow:{display:"flex",alignItems:"center",gap:6,fontSize:10,color:"#6a8a70",marginBottom:4},
  taskLegendDot:{width:14,height:8,borderRadius:2,display:"inline-block"},

  // ── マップ ──
  mapArea:{flex:1,display:"flex",flexDirection:"column",padding:"8px 12px",overflow:"hidden"},
  toolbar:{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"},
  modeButtons:{display:"flex",gap:4},
  modeBtn:{background:"#162318",border:"1px solid #2d4a30",color:"#8fa890",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11,transition:"all .15s"},
  toggleGroup:{display:"flex",gap:10,marginLeft:"auto"},
  toggle:{display:"flex",alignItems:"center",gap:4,cursor:"pointer"},
  toggleLabel:{fontSize:11,color:"#8fa890"},
  modeHint:{fontSize:10,padding:"4px 10px",border:"1px solid",borderRadius:6,marginBottom:6},
  svg:{flex:1,borderRadius:10,border:"1px solid #2d4a30",minHeight:0},
  legend:{display:"flex",gap:10,marginTop:6,flexWrap:"wrap"},
  legendItem:{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#6a8a70"},
  legendDot:{width:10,height:10,borderRadius:"50%",display:"inline-block"},

  // ── 棟設定 ──
  tentsGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12,padding:16,overflowY:"auto",flex:1,alignContent:"start"},
  tentBigCard:{background:"#162318",border:"2px solid",borderRadius:10,padding:"14px 16px"},
  tentBigHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12},
  tentBigName:{fontSize:18,fontWeight:"bold",color:"#c8a85e"},
  tentBigRow:{display:"flex",gap:8,marginBottom:10},
  tentBigStats:{fontSize:11,color:"#6a8a70",marginTop:6},
  bedViz:{display:"flex",gap:3,flexWrap:"wrap",marginTop:6},
  bedIcon:{width:22,height:14,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center"},
  badge:{fontSize:9,borderRadius:4,padding:"2px 6px",color:"#fff",fontFamily:"monospace"},
  field:{flex:1},
  fieldLabel:{fontSize:9,color:"#6a8a70",marginBottom:3,fontFamily:"monospace",letterSpacing:.5},
  fieldControls:{display:"flex",alignItems:"center",gap:4},
  fieldVal:{fontSize:15,fontWeight:"bold",color:"#f0e6d0",minWidth:22,textAlign:"center"},
  btn:{background:"#1e3020",border:"1px solid #3a5a3a",color:"#c8a85e",width:20,height:20,borderRadius:4,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",padding:0},
};