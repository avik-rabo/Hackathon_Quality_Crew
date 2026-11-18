'use strict';
const byId = id => document.getElementById(id);
const html = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 2});
const scoreNumber = new Intl.NumberFormat('en-US', {maximumSignificantDigits: 10});
const dollars = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0});
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const demo = {
  name:'Sales operations', source:'Sample data',
  columns:['Deal','Account','Region','Stage','Closed date','Revenue','Owner'],
  rows: Array.from({length:216}, (_, i) => {
    const m = Math.floor(i / 36), j = i % 36;
    return [
      'DL-' + (1041+i), ['Northstar Labs','Meridian Health','Atlas Group','Verdant Systems','Summit Digital','Harbor Works','Juniper Retail','Aster Energy','Cobalt Labs'][i%9],
      ['North America','Europe','Asia Pacific','Latin America'][(j*7+Math.floor(j/6)+m)%4],
      j%9===0 ? 'Pending' : j%7===0 ? 'Lost' : 'Won',
      '2026-0'+(m+1)+'-'+String(1+(j*3)%28).padStart(2,'0'),
      j%9===0 || j%7===0 ? 0 : 12000+m*2300+((i*7837)%24000),
      i%19===0 ? '' : ['Avery Kim','Jordan Reed','Morgan Ellis','Sam Patel'][i%4]
    ];
  })
};
const outcomeDemo = {
  name:'Customer data quality',source:'Sample data',
  columns:['Full date','Rule name','Rule key','Population name','Population party type','Population','Valid count','Invalid count','DQ score'],
  rows:[
    ['17-11-2026','Email format','1','Retail','Individual',1200,1128,72,'93.5%'],
    ['18-11-2026','Email format','1','Business','Organization',400,388,12,'97%'],
    ['18-11-2026','Customer ID present','2','Retail','Individual',1200,1197,3,'99.75%'],
    ['18-11-2026','Customer ID present','2','Business','Organization',400,400,0,'100%'],
    ['18-11-2026','Consent date present','3','Retail','Individual',1200,1100,20,'91.67%'],
    ['18-11-2026','Consent date present','3','New market','Individual',0,0,0,'']
  ]
};
let dataset = null, view = 'Start', page = 0, search = '', segment = null, windowSize = 'all', missingOnly = false;
let measure, dimension, dateField, schema, sources = [];
let assistantSetup = null, externalProvider = null;
let assistantFilter = null, assistantVersion = 0, modelEnabled = false, copilotConfigured = false, previousAssistantPlan = null, assistantAscending = false;
let profileSettings = {}, referenceFile = null, referenceRequest = 0;
let outcomeMapping = {};
let workspaceDefaults = {};
let datasetMode = 'auto', outcomeFilters = {};
let requestId = 0, timeChart = 'line', groupChart = 'bar';
const pages = [['Start','⌂'],['Dashboard','▥'],['Explore records','≡']];
const blank = value => value == null || String(value).trim() === '';
const numeric = value => !blank(value) && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value).trim()) && Number.isFinite(Number(value));
const dateMonth = value => /^(\d{4}-(?:0[1-9]|1[0-2]))-\d{2}(?:$|[T ])/.exec(String(value ?? ''))?.[1] || '';
function applyData(next) {
  datasetMode = 'auto';
  outcomeFilters = {};
  if (dataset !== next) {
    profileSettings = {};
    outcomeMapping = dataProfile.mapOutcomeFields(next.columns,workspaceDefaults.outcomeFields);
    referenceFile = null;
    referenceRequest++;
  }
  assistantVersion++;
  assistantFilter = null;
  assistantAscending = false;
  previousAssistantPlan = null;
  byId('assistantHistory').replaceChildren();
  byId('assistantAnswer').textContent = '';
  byId('assistantQuestion').value = '';
  dataset = next;
  schema = dataset.columns.map((name, index) => {
    const values = dataset.rows.map(row => row[index]).filter(value => !blank(value));
    const key = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    const identifier = /(?:^|[ _-])(?:id|uuid|key|zip|postal|phone|code)(?:$|[ _-])/.test(key);
    const date = values.length > 0 && values.every(dateMonth);
    const numericField = values.length > 0 && values.every(numeric);
    const distinct = new Set(values.map(String)).size;
    const category = !date && values.length > 0 && distinct <= 25 &&
      (distinct < values.length || (!identifier && !numericField && distinct <= 5));
    return {name, index, identifier, date, numeric: numericField, category, distinct};
  });
  measure = next === demo ? 5 : schema.find(field => field.numeric && !field.identifier)?.index ?? -1;
  dateField = next === demo ? 4 : schema.find(field => field.date)?.index ?? -1;
  dimension = next === demo ? 2 : schema.find(field => field.category && !field.identifier && !field.numeric)?.index ??
    schema.find(field => field.category && !field.identifier && field.index !== measure)?.index ??
    schema.find(field=>!field.date && !field.numeric && !field.identifier && field.distinct > 0 && field.distinct <= 25)?.index ?? -1;
  windowSize = 'all';
  const matchingField=(name,test)=>schema.find(field=>field.name===name && test(field))?.index;
  if (workspaceDefaults.measure===null) measure=-1;
  else measure=matchingField(workspaceDefaults.measure,field=>field.numeric)??measure;
  if (workspaceDefaults.dimension===null) dimension=-1;
  else dimension=matchingField(workspaceDefaults.dimension,field=>!field.date)??dimension;
  if (workspaceDefaults.dateField===null) dateField=-1;
  else dateField=matchingField(workspaceDefaults.dateField,field=>field.date)??dateField;
  if (dateField>=0 && workspaceDefaults.period) windowSize=workspaceDefaults.period;
  if (workspaceDefaults.timeChart) timeChart=workspaceDefaults.timeChart;
  if (workspaceDefaults.groupChart) groupChart=workspaceDefaults.groupChart;
  if (workspaceDefaults.profileKey===null) profileSettings.key=-1;
  else {
    const key=matchingField(workspaceDefaults.profileKey,()=>true);
    if (key!==undefined) profileSettings.key=key;
  }
  const savedFreshness=workspaceDefaults.freshness;
  if (savedFreshness) {
    const field=matchingField(savedFreshness.field,item=>item.date);
    if (field!==undefined) profileSettings.freshness={...savedFreshness,field};
  }
  segment = null; missingOnly = false; search = ''; page = 0;
  if (reportMode()!=='raw') windowSize='all';
  navigate('Dashboard');
}
const format = value => dataset === demo && measure === 5 ? dollars.format(value) : number.format(value);
const metricLabel = () => measure < 0 ? 'Records' : dataset.columns[measure];
const amount = row => measure < 0 ? 1 : numeric(row[measure]) ? Number(row[measure]) : 0;
function dateKeys() {
  return [...new Set(dataset.rows.map(row => dateMonth(row[dateField])).filter(Boolean))].sort();
}
function scopedRows() {
  const allowed = windowSize === 'all' ? null : new Set(dateKeys().slice(-Number(windowSize)));
  return dataset.rows.filter(row => (!allowed || allowed.has(dateMonth(row[dateField]))) && (!assistantFilter || assistantFilter(row)));
}
function matchingRows() {
  const term = search.toLowerCase();
  return scopedRows().filter(row =>
    (!segment || segment.match(row)) && (!missingOnly || row.some(blank)) &&
    (!term || row.some(value => String(value ?? '').toLowerCase().includes(term))));
}
function aggregate(rows, label) {
  const result = new Map();
  rows.forEach(row => {
    const key = label(row);
    if (key !== '') result.set(key, (result.get(key) ?? 0) + amount(row));
  });
  return [...result];
}
const missingGroup = Symbol('Missing group');
const groupKey = row => blank(row[dimension]) ? missingGroup : String(row[dimension]);
const groupLabel = key => key === missingGroup ? '(Missing)' : key;
const dateLabel = key => months[Number(key.slice(5))-1] + ' ’' + key.slice(2,4);
const hero = (label,title,description,action='') => '<section class="hero"><div><div class="eyebrow">'+html(label)+'</div><h1>'+html(title)+'</h1>'+
  (description?'<p>'+html(description)+'</p>':'')+'</div>'+action+'</section>';
const action = (label, id, primary=false) => '<button type="button" class="btn'+(primary?' primary':'')+'" id="'+id+'">'+label+'</button>';
const options = (entries,selected) => entries.map(([value,label]) => '<option value="'+html(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+html(label)+'</option>').join('');
function drill(label,match) {
  segment = {label,match}; search = ''; missingOnly = false; page = 0; view = 'Explore records'; render();
  if (typeof window!=='undefined') window.scrollTo(0,0);
}
function navigate(name, section) {
  segment = null; missingOnly = false; search = ''; page = 0; view = name; render();
  if (section) byId(section)?.scrollIntoView({block:'start'});
  else if (typeof window!=='undefined') window.scrollTo(0,0);
}
function listen(id, fn, event='click') { byId(id)?.addEventListener(event,fn); }
function performance() {
  const rows = scopedRows();
  const missing = rows.filter(row => row.some(blank)).length;
  const filled = rows.reduce((sum,row) => sum + row.filter(value => !blank(value)).length,0);
  const completeness = rows.length ? number.format(100*filled/(rows.length*dataset.columns.length))+'%' : '—';
  const metrics = [
    ['Records',number.format(rows.length),'In the current view',()=>true],
    ['Completeness',completeness,number.format(missing)+' records with missing fields',row=>row.some(blank)]
  ];
  if (measure >= 0) {
    const values = rows.filter(row=>numeric(row[measure]));
    const total = values.reduce((sum,row)=>sum+amount(row),0);
    metrics.unshift(
      ['Total '+metricLabel(),values.length?format(total):'—','Sum across populated values',row=>numeric(row[measure])],
      ['Average '+metricLabel(),values.length?format(total/values.length):'—','Per populated numeric value',row=>numeric(row[measure])]
    );
  } else {
    metrics.unshift(
      ['Fields',number.format(dataset.columns.length),'Columns in this dataset',()=>true],
      dimension >= 0
        ? ['Distinct '+dataset.columns[dimension],number.format(new Set(rows.filter(row=>!blank(row[dimension])).map(groupKey)).size),'Across populated values',row=>!blank(row[dimension])]
        : ['Incomplete records',number.format(missing),'Rows with at least one missing field',row=>row.some(blank)]
    );
  }
  const times = dateField < 0 ? [] : aggregate(rows,row=>dateMonth(row[dateField])).sort(([a],[b])=>a.localeCompare(b)).slice(-12);
  const allGroups = dimension < 0 ? [] : aggregate(rows,groupKey).sort((a,b)=>assistantAscending?a[1]-b[1]:b[1]-a[1]);
  if (times.length>=2) {
    const [earlier,latest]=times.slice(-2);
    metrics[1]=['Change from previous observed month',format(latest[1]-earlier[1]),
      dateLabel(earlier[0])+' to '+dateLabel(latest[0]),row=>[earlier[0],latest[0]].includes(dateMonth(row[dateField]))];
  }
  const canDonut = allGroups.length > 0 && allGroups.every(([,value])=>value>=0) &&
    allGroups.some(([,value])=>value>0);
  const donut = groupChart === 'donut' && canDonut;
  const topGroups = allGroups.slice(0,donut && allGroups.length>5 ? 4 : 5);
  const groups = topGroups.map(([key,value])=>[groupLabel(key),value,row=>groupKey(row)===key]);
  if (donut && allGroups.length>topGroups.length) {
    const remaining = new Set(allGroups.slice(topGroups.length).map(([key])=>key));
    const remainingTotal = allGroups.slice(topGroups.length).reduce((sum,[,value])=>sum+value,0);
    groups.push(['Other groups ('+remaining.size+')',remainingTotal,row=>remaining.has(groupKey(row))]);
  }
  const missingFields = schema.map(({name,index})=>({
    name,index,count:rows.filter(row=>blank(row[index])).length
  })).filter(field=>field.count>0).sort((a,b)=>b.count-a.count).slice(0,5);
  const measures = schema.filter(field=>field.numeric).map(({index,name})=>[index,name]);
  const dates = schema.filter(field=>field.date).map(({index,name})=>[index,name]);
  const dimensions = schema.filter(field=>!field.date).map(({index,name})=>[index,'By '+name]);
  const panel = (title,description,body,control='') => '<section class="panel"><div class="panelhead"><div><h3>'+html(title)+'</h3><p>'+html(description)+'</p></div>'+control+'</div>'+body+'</section>';
  const scale = points => Math.max(1,...points.map(([,value])=>Math.abs(value)));
  const percent = (value,max) => Math.abs(value)/max*100;
  const rank = (entries,id,max,label) => '<div class="rank">'+entries.map(([key,value],i)=>
    '<button id="'+id+i+'"><span>'+html(key)+'</span><strong>'+html(label(value))+'</strong><span class="track"><span style="width:'+percent(value,max)+'%;'+(value<0?'background:#F36717':'')+'"></span></span></button>'
  ).join('')+'</div>';
  const panels = [];
  if (times.length) {
    const controls = '<select id="timeChart" aria-label="Monthly chart type">'+options([['line','Trend line'],['bar','Column chart'],['table','Data table']],timeChart)+'</select>';
    const points = times.map(([key,value])=>[dateLabel(key),value]);
    let body = chartTable(points,'month');
    if (timeChart === 'line') body = trendLine(points);
    if (timeChart === 'bar') body = columnChart(points);
    panels.push(panel(metricLabel()+' by month','Based on '+dataset.columns[dateField]+'. Select a month to see its records.',body,controls));
  }
  if (groups.length) {
    const choices = [['bar','Bar chart'],['donut','Donut chart'],['table','Data table']];
    const controls = '<select id="groupChart" aria-label="Group chart type">'+choices.map(([value,label])=>
      '<option value="'+value+'"'+(value===(donut?'donut':groupChart==='table'?'table':'bar')?' selected':'')+
      (value==='donut'&&!canDonut?' disabled':'')+'>'+label+'</option>').join('')+'</select>';
    let body = rank(groups,'group',scale(groups),format);
    if (donut) body = donutChart(groups);
    if (groupChart === 'table') body = chartTable(groups,'group');
    const hint = canDonut ? '' : ' Donuts require nonnegative totals and at least one positive group.';
    const panelContent = panel(metricLabel()+' by '+dataset.columns[dimension],
      (donut ? 'Share of the total. ' : 'Top '+groups.length+' groups. ')+'Select a group to see its records.'+hint,body,controls);
    panels.push(panelContent);
  }
  if (panels.length < 2) {
    panels.push(panel('Field completeness','Select a field to inspect its missing records.',
      missingFields.length ? rank(missingFields.map(({name,count})=>[name,count]),'qualityField',rows.length,value=>number.format(value)+' missing')
        : '<p class="empty">'+(rows.length?'All fields are populated in the current view.':'The source returned no records.')+'</p>'));
  }
  byId('dashboardPerformance').innerHTML = '<div class="toolbar"><h2>Performance</h2><div class="filters">' +
    (measures.length ? '<select id="measure" aria-label="Measure">'+options([[-1,'Record count'],...measures],measure)+'</select>' : '')+
    (dimensions.length ? '<select id="dimension" aria-label="Group by">'+options([[-1,'No grouping'],...dimensions],dimension)+'</select>' : '')+
    (dates.length ? '<select id="dateField" aria-label="Date column">'+options([[-1,'No date field'],...dates],dateField)+'</select>' : '')+
    (dateField < 0 ? '' : '<select id="period" aria-label="Reporting period">'+options([['all','All dates'],['6','Last 6 observed months'],['3','Last 3 observed months'],['1','Latest observed month'],...(['all','6','3','1'].includes(windowSize)?[]:[[windowSize,'Last '+windowSize+' observed months']])],windowSize)+'</select>')+
    '</div></div><div class="cards">'+metrics.map(([label,value,caption],i)=>'<button class="card" id="metric'+i+'"><span>'+html(label)+' <span aria-hidden="true">↗</span></span><strong>'+html(value)+'</strong><small>'+html(caption)+'</small></button>').join('')+
    '</div><div class="grid'+(panels.length===1?' single':'')+'">'+panels.join('')+'</div>'+
    '<section class="panel tablepanel"><div class="panelhead"><div><h3>Underlying records</h3><p>Preview of the current selection.</p></div>'+action('View all ↗','allRecords')+'</div>'+table(rows.slice(0,5))+'</section>';
  listen('allRecords',()=>navigate('Explore records'));
  metrics.forEach(([label,,,match],i)=>listen('metric'+i,()=>drill(label,match)));
  times.forEach(([key],i)=>listen('month'+i,()=>drill(dateLabel(key),row=>dateMonth(row[dateField])===key)));
  groups.forEach(([label,,match],i)=>listen('group'+i,()=>drill(label,match)));
  missingFields.forEach(({name,index},i)=>listen('qualityField'+i,()=>drill('Missing '+name,row=>blank(row[index]))));
  listen('measure',e=>{measure=Number(e.target.value);render();byId('measure').focus();},'change');
  listen('dimension',e=>{dimension=Number(e.target.value);render();byId('dimension').focus();},'change');
  listen('dateField',e=>{assistantFilter=null;dateField=Number(e.target.value);windowSize='all';render();byId('dateField').focus();},'change');
  listen('period',e=>{assistantFilter=null;windowSize=e.target.value;render();byId('period').focus();},'change');
  listen('timeChart',e=>{timeChart=e.target.value;render();byId('timeChart').focus();},'change');
  listen('groupChart',e=>{groupChart=e.target.value;render();byId('groupChart').focus();},'change');
  bindRows(rows.slice(0,5));
}
function chartTable(points,id) {
  return '<div class="scroll"><table><thead><tr><th scope="col">'+(id==='month'?'Month':'Group')+
    '</th><th scope="col">'+html(metricLabel())+'</th></tr></thead><tbody>'+
    points.map(([label,value],i)=>'<tr><td><button id="'+id+i+'">'+html(label)+'</button></td><td>'+
      html(format(value))+'</td></tr>').join('')+'</tbody></table></div>';
}
function trendLine(points) {
  const values = points.map(([,value])=>value);
  const low = Math.min(0,...values), high = Math.max(0,...values);
  const y = value => 10+(high-value)/(high-low||1)*80;
  const x = i => (i+.5)/points.length*100;
  const path = points.map(([,value],i)=>x(i)+','+y(value)).join(' ');
  return '<div class="trend"><div class="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+
    '<line x1="0" x2="100" y1="'+y(0)+'" y2="'+y(0)+'" vector-effect="non-scaling-stroke"/>'+
    '<polyline points="'+path+'" vector-effect="non-scaling-stroke"/></svg>'+
    points.map(([label,value],i)=>'<button class="point" id="month'+i+'" style="--x:'+x(i)+'%;--y:'+y(value)+'%" title="'+
      html(label+' · '+format(value))+'" aria-label="'+html(label+' '+format(value))+'"></button>').join('')+
    '</div><div class="axis" style="--count:'+points.length+'">'+points.map(([label])=>'<span>'+html(label)+'</span>').join('')+'</div></div>';
}
function columnChart(points) {
  const values = points.map(([,value])=>value);
  const low = Math.min(0,...values), high = Math.max(0,...values);
  const percent = value => (value-low)/(high-low||1)*100;
  return '<div class="chart" style="--count:'+points.length+';--zero:'+percent(0)+'%">'+points.map(([label,value],i)=>
    '<button class="bar" id="month'+i+'" style="--bottom:'+Math.min(percent(value),percent(0))+'%;--height:'+
      Math.abs(percent(value)-percent(0))+'%" title="'+html(label+' · '+format(value))+'" aria-label="'+html(label+' '+format(value))+
      '"><span class="barplot"><b'+(value<0?' class="negative"':'')+'></b></span><span>'+html(label)+'</span></button>'
  ).join('')+'</div>';
}
function donutChart(groups) {
  const colors = ['#2C3696','#F36717','#F9B248','#8793DB','#6F78A9'];
  const total = groups.reduce((sum,[,value])=>sum+value,0);
  let position = 0;
  const stops = groups.map(([,value],i)=>{
    const start = position;
    position += value/total*100;
    return colors[i]+' '+start+'% '+Math.min(position,100)+'%';
  }).join(',');
  return '<div class="donut-layout"><div class="donut" style="--slices:'+stops+'" aria-hidden="true"><div><strong>'+
    html(format(total))+'</strong><span>Total</span></div></div><div class="donut-key">'+groups.map(([label,value],i)=>
    '<button id="group'+i+'" title="'+html(label+' · '+format(value))+'"><span class="swatch" style="--swatch:'+colors[i]+'"></span>'+
    '<span>'+html(label)+'</span><strong>'+html(number.format(value/total*100))+'%</strong></button>'
  ).join('')+'</div></div>';
}
function table(rows) {
  if (!rows.length) return '<p class="empty">No matching records.</p>';
  return '<div class="scroll"><table><thead><tr>'+dataset.columns.map(name=>'<th scope="col">'+html(name)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map((row,i)=>'<tr>'+row.map((value,j)=>'<td>'+(j===0?'<button id="row'+i+'" aria-label="'+html('Open record '+(blank(value)?i+1:value))+'">'+html(blank(value)?'Open record':value)+'</button>':html(blank(value)?'—':dataset===demo&&j===5?dollars.format(value):value))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function bindRows(rows) {
  rows.forEach((row,i)=>listen('row'+i,()=>showRecord(row)));
}
function showRecord(row) {
  byId('fields').innerHTML = dataset.columns.map((name,j)=>'<dt>'+html(name)+'</dt><dd>'+html(blank(row[j])?'—':row[j])+'</dd>').join('');
  byId('detail').showModal();
}
function explore() {
  byId('app').innerHTML = hero(dataset.name,'Explore records','Inspect the rows behind your report and export the current selection.')+
    '<div class="toolbar"><h2>'+html(segment?.label || 'All records')+'</h2><div class="filters"><input id="search" type="search" placeholder="Search records" aria-label="Search records" value="'+html(search)+'">'+
    (segment?action('Clear drill-through','clear'):'')+action('Export CSV ↓','export')+'</div></div><section class="panel" id="result"></section>';
  listen('search',e=>{search=e.target.value;page=0;renderRows();},'input');
  listen('clear',()=>{segment=null;missingOnly=false;page=0;render();});
  listen('export',()=>download(matchingRows()));
  renderRows();
}
function renderRows() {
  const rows = matchingRows(), limit = 12, visible = rows.slice(page*limit,(page+1)*limit);
  byId('result').innerHTML = table(visible)+'<div class="pager"><span class="subtle" role="status">'+(rows.length ? (page*limit+1)+'–'+(page*limit+visible.length)+' of '+number.format(rows.length) : '0 records')+'</span><div>'+
    '<button class="btn" id="prev" '+(page===0?'disabled':'')+'>Previous</button> <button class="btn" id="next" '+((page+1)*limit>=rows.length?'disabled':'')+'>Next</button></div></div>';
  listen('prev',()=>{page--;renderRows();byId(page===0?'next':'prev').focus();});
  listen('next',()=>{page++;renderRows();byId((page+1)*limit>=rows.length?'prev':'next').focus();});
  bindRows(visible);
}
function fieldSelect(id,label,fields,selected) {
  return '<label for="'+id+'">'+html(label)+'<select id="'+id+'" required>'+
    options(fields.map(({index,name})=>[index,name]),selected)+'</select></label>';
}
function referenceOptions(fields) {
  if (!referenceFile) return '';
  const referenceFields = referenceFile.columns.map((name,index)=>({name,index,key:dataProfile.fieldName(name)}));
  const current = profileSettings.accuracy;
  const shared = fields.filter(field=>referenceFields.some(other=>other.key===field.key));
  const sourceKey = current?.sourceKey ?? (shared.find(field=>field.key==='id'||field.key.endsWith('_id')) ?? shared[0] ?? fields[0]).index;
  const sourceField = current?.sourceField ?? (shared.find(field=>field.index!==sourceKey) ?? fields.find(field=>field.index!==sourceKey) ?? fields[0]).index;
  const corresponding = index=>referenceFields.find(field=>field.key===fields[index].key)?.index ?? 0;
  return '<form class="profile-controls" id="accuracyForm">'+
    fieldSelect('sourceKey','Source key',fields,sourceKey)+
    fieldSelect('referenceKey','Reference key',referenceFields,current?.referenceKey ?? corresponding(sourceKey))+
    fieldSelect('sourceField','Source value',fields,sourceField)+
    fieldSelect('referenceField','Reference value',referenceFields,current?.referenceField ?? corresponding(sourceField))+
    '<button class="btn primary" type="submit">Run comparison</button>'+
    (current?action('Clear comparison','clearAccuracy'):'')+'</form>';
}
function resultLabel(rule) {
  if (rule.failed) return 'Fail';
  if (rule.passed) return rule.skipped || rule.excluded ? 'Pass with gaps' : 'Pass';
  return 'Not assessed';
}
function passRate(rule) {
  return rule.passed+rule.failed ? number.format(100*rule.passed/(rule.passed+rule.failed))+'%' : '—';
}
function derivePopulation(mapping = outcomeMapping) {
  const fields = dataProfile.reportedFields(dataset.columns);
  return mapping.population<0 && fields?.countFormat ? fields : null;
}
function outcomeGroupLabel(item) {
  const label = item.label || (item.population===null?'(Missing)':number.format(item.population)+(outcomeMapping.group>=0?' (by size)':''));
  const detail = item.party || item.ruleKey;
  return detail ? label+' · '+detail : label;
}
function renderOutcomeMapping(root,mapped) {
  const fields = dataProfile.outcomeFields;
  const controls = fields.map(([key,label,required])=>{
    const canDerive = key==='population' && dataProfile.reportedFields(dataset.columns)?.countFormat;
    const empty = required && !canDerive ? '' : -1;
    return '<label for="outcome-'+key+'">'+html(label)+'<select id="outcome-'+key+'"'+(empty===''?' required':'')+'>'+
      options([[empty,canDerive?'Use valid, invalid and not assessed':required?'Choose a column':'None'],
        ...dataset.columns.map((name,index)=>[index,name])],outcomeMapping[key]<0?empty:outcomeMapping[key])+'</select></label>';
  }).join('');
  root.innerHTML = '<details class="panel profile-section"'+(mapped?'':' open')+'><summary>Outcome column mapping</summary>'+
    '<form id="outcomeMapping" class="profile-controls">'+controls+'<button class="btn primary" type="submit">Apply mapping</button></form>'+
    '<p class="notice" id="outcomeStatus" role="status">'+(mapped?'':'Map the rule, population, valid count, and invalid count.')+'</p></details>';
  listen('outcomeMapping',event=>{
    event.preventDefault();
    const next = Object.fromEntries(fields.map(([key])=>{
      const {value} = byId('outcome-'+key);
      return [key,value===''?-1:Number(value)];
    }));
    if (!dataProfile.validOutcomeMapping(next,derivePopulation(next))) {
      byId('outcomeStatus').textContent = 'Choose a different column for each mapped field and fill all required fields.';
      return;
    }
    outcomeMapping = next;
    outcomeFilters = {};
    render();
    byId('outcome-ruleFilter').focus();
  },'submit');
}
function ruleOutcomes() {
  const derived = derivePopulation();
  const mapped = dataProfile.validOutcomeMapping(outcomeMapping,derived);
  const root = byId('dashboardOutcomes');
  root.innerHTML = '';
  if (!mapped || datasetMode==='outcomes') renderOutcomeMapping(root,mapped);
  if (!mapped) return;

  const {results,excluded} = dataProfile.readOutcomes(scopedRows(),outcomeMapping,derived);
  const showGroup = outcomeMapping.group>=0, showParty = outcomeMapping.party>=0;
  const showScore = outcomeMapping.score>=0, showDate = outcomeMapping.date>=0;
  const showKey = outcomeMapping.ruleKey>=0;
  const headers = ['Rule',...(showKey?['Rule key']:[]),...(showDate?['Outcome date']:[]),...(showGroup?['Population name']:[]),
    ...(showParty?['Party type']:[]),derived?'Derived population':'Population','Valid','Invalid','Unclassified',
    ...(showScore?['Reported score']:[]),'Pass rate'];
  const groupByChoices = [['population','Population'],['rule','Rule'],...(showParty?[['party','Party type']]:[]),
    ...(showDate?[['date','Outcome date']]:[])];
  const orderChoices = [['invalid','Most invalid records'],['rate','Highest invalid rate'],
    ...(showScore?[['scoreLow','Lowest score'],['scoreHigh','Highest score']]:[]),
    ...(showDate?[['date','Newest outcome date']]:[])];
  const select = (key,label,entries,value='')=>'<label><span id="outcome-'+key+'-label">'+html(label)+'</span><select id="outcome-'+key+
    '" aria-labelledby="outcome-'+key+'-label">'+
    options(entries,outcomeFilters[key]??value)+'</select></label>';
  const choices = (key,label,entries)=>select(key,label,[['','All '+label.toLowerCase()+'s'],...entries]);
  const distinct = key=>[...new Set(results.map(item=>item[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(value=>[value,value]);
  const rules = [...new Map(results.map(item=>[dataProfile.outcomeIdentity(item),item.rule+(item.ruleKey?' · '+item.ruleKey:'')]))]
    .sort(([,a],[,b])=>a.localeCompare(b));
  const input = (key,label,type)=>'<label>'+label+'<input id="outcome-'+key+'" type="'+type+'"'+(type==='number'?' step="any"':'')+
    ' value="'+html(outcomeFilters[key]??'')+'"></label>';
  const tableHead = labels=>'<thead><tr>'+labels.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead>';
  root.insertAdjacentHTML('beforeend',
    (excluded.size?'<p class="notice">'+number.format(excluded.size)+(excluded.size===1?' source row excluded. ':' source rows excluded. ')+
      'A usable row has a rule name and nonnegative whole counts that fit its population. '+action('View excluded rows','excludedOutcomes')+'</p>':'')+
    '<section class="panel profile-section" id="outcomeFilters"><h2 class="sectiontitle">Filter outcomes</h2>'+
    '<div class="profile-controls">'+choices('ruleFilter','Rule',rules)+
    (showGroup?choices('groupFilter','Population',distinct('group')):'')+
    (showParty?select('partyFilter','Party type',[['','All party types'],...distinct('party')]):'')+
    (showDate?input('from','From date','date')+input('to','To date','date'):'')+
    (showScore?input('minScore','Minimum score','number')+input('maxScore','Maximum score','number'):'')+
    '<label class="inline-check"><input id="outcome-failures" type="checkbox"'+(outcomeFilters.failures?' checked':'')+'> With invalid records</label>'+
    action('Clear filters','clearOutcomeFilters')+'</div><p class="notice" id="outcomeFilterStatus" role="status"></p></section>'+
    '<div class="profile-stats outcome-stats" id="outcomeStats"></div>'+
    '<section class="panel profile-section" id="outcomeBreakdown"><div class="panelhead"><div><h2 class="sectiontitle">Outcome breakdown</h2>'+
    '<p>A rule fails when an outcome has invalid records. Each rule is counted once per group and once overall.</p>'+
    '<p>Largest invalid count comes from a single outcome row. Rows without a population name are grouped by size.</p></div>'+
    '<div class="profile-controls">'+select('breakdown','Break down by',groupByChoices,'population')+
    action('Export breakdown ↓','exportPopulationSummary')+'</div></div><div id="outcomeCharts" class="outcome-visuals"></div>'+
    '<div id="populationResults"></div></section>'+
    '<div class="toolbar" id="outcomeDetails"><div><h2>Reported results</h2><p class="subtle">Scores are shown as supplied. Pass rate uses valid ÷ (valid + invalid).</p></div>'+
    '<div class="profile-controls">'+select('sort','Order by',orderChoices,'invalid')+
    action('Explore filtered rows ↗','exploreOutcomes')+action('Export results ↓','exportOutcomes')+'</div></div>'+
    '<p class="notice" id="selectedPopulation" hidden></p><section class="panel" id="outcomeResults"></section>');
  listen('excludedOutcomes',()=>drill('Excluded rule outcomes',row=>excluded.has(row)));

  let breakdown = [], buckets = [], filtered = [], selectedGroup = null, outcomePage = 0;
  const values = (item,display)=>{
    const formatCount = display ? value=>number.format(value) : value=>value;
    return [...(showKey?[item.ruleKey]:[]),...(showDate?[item.sourceDate]:[]),...(showGroup?[item.group]:[]),...(showParty?[item.party]:[]),
      ...[item.population,item.valid,item.invalid,item.unclassified].map(formatCount),...(showScore?[item.score]:[]),
      item.rate===null?'':number.format(100*item.rate)+'%'];
  };
  const groupValues = group=>[outcomeGroupLabel(group),group.failed,group.rules,group.failedOutcomes,group.maxInvalid];
  const groupHeaders = ()=>[groupByChoices.find(([id])=>id===(outcomeFilters.breakdown||'population'))[1],
    'Failed rules','Distinct rules','Outcomes with invalid records','Largest invalid count'];
  const sortedResults = ()=>{
    const sort = outcomeFilters.sort || 'invalid';
    const compareScore = direction=>(a,b)=>a.scoreValue===null ? Number(b.scoreValue!==null) :
      b.scoreValue===null ? -1 : direction*(a.scoreValue-b.scoreValue);
    const comparators = {
      invalid:(a,b)=>b.invalid-a.invalid,
      rate:(a,b)=>(a.rate??2)-(b.rate??2),
      scoreLow:compareScore(1),scoreHigh:compareScore(-1),
      date:(a,b)=>b.date.localeCompare(a.date)
    };
    return [...(selectedGroup?.outcomes ?? filtered)].sort(comparators[sort]);
  };
  const renderResults = ()=>{
    const rows = sortedResults(), limit = 12, offset = outcomePage*limit;
    const visible = rows.slice(offset,offset+limit);
    const table = '<div class="scroll"><table>'+tableHead(headers)+
      '<tbody>'+visible.map((item,index)=>'<tr><td><button id="outcomeRow'+index+'">'+html(item.rule)+'</button></td>'+
      values(item,true).map(value=>'<td>'+html(value===''?'—':value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    byId('outcomeResults').innerHTML = (visible.length?table:'<p class="empty">No matching rule outcomes.</p>')+
      '<div class="pager"><span class="subtle" role="status">'+(rows.length?(offset+1)+'–'+(offset+visible.length)+' of '+number.format(rows.length):'0 outcomes')+
      '</span><div><button class="btn" id="outcomePrev"'+(outcomePage===0?' disabled':'')+'>Previous</button> '+
      '<button class="btn" id="outcomeNext"'+(offset+limit>=rows.length?' disabled':'')+'>Next</button></div></div>';
    listen('outcomePrev',()=>{outcomePage--;renderResults();byId(outcomePage===0?'outcomeNext':'outcomePrev').focus();});
    listen('outcomeNext',()=>{outcomePage++;renderResults();byId((outcomePage+1)*limit>=rows.length?'outcomePrev':'outcomeNext').focus();});
    visible.forEach(({row},index)=>listen('outcomeRow'+index,()=>showRecord(row)));
    byId('exportOutcomes').disabled = byId('exploreOutcomes').disabled = !rows.length;
  };
  const selectGroup = group=>{
    selectedGroup = group;
    outcomePage=0;
    byId('selectedPopulation').hidden = !group;
    byId('selectedPopulation').innerHTML = group ? 'Showing '+html(outcomeGroupLabel(group))+' '+action('Show all matching outcomes','clearPopulation') : '';
    listen('clearPopulation',()=>{selectGroup(null);byId('outcome-sort').focus();});
    renderResults();
  };
  const refresh = ()=>{
    const {from,to,minScore,maxScore} = outcomeFilters;
    const badDates = from && to && from>to;
    const badScores = minScore!==undefined && maxScore!==undefined && Number(minScore)>Number(maxScore);
    byId('outcomeFilterStatus').textContent = badDates?'Choose an end date on or after the start date.':
      badScores?'Choose a maximum score at or above the minimum.':'';
    filtered = badDates || badScores ? [] : filterOutcomeRows(results,outcomeFilters);
    const summary = dataProfile.summarizeOutcomes(filtered,outcomeFilters.breakdown);
    breakdown = summary.populations;
    const distribution = outcomeScoreDistribution(filtered);
    buckets = distribution.buckets;
    const groupBy = outcomeFilters.breakdown || 'population';
    byId('outcomeCharts').innerHTML = outcomeRankingChart(breakdown,groupBy)+outcomeScoreChart(distribution);
    const maxInvalid = filtered.reduce((max,item)=>Math.max(max,item.invalid),0);
    byId('outcomeStats').innerHTML = [['Failed rules',summary.failed],['Distinct rules',summary.rules],
      ['Matching outcomes',filtered.length],['Largest invalid count',filtered.length?maxInvalid:null]]
      .map(([label,value])=>'<div><strong>'+(value===null?'—':number.format(value))+'</strong><span>'+label+'</span></div>').join('');
    byId('populationResults').innerHTML = breakdown.length ?
      '<div class="scroll population-summary"><table>'+tableHead(groupHeaders())+'<tbody>'+
      breakdown.map((item,index)=>'<tr><td><button type="button" data-population="'+index+'">'+html(outcomeGroupLabel(item))+
        '</button></td>'+groupValues(item).slice(1).map(value=>'<td>'+number.format(value)+'</td>').join('')+'</tr>').join('')+
      '</tbody></table></div>' : '<p class="empty">No matching groups.</p>';
    byId('exportPopulationSummary').disabled = !breakdown.length;
    selectGroup(null);
  };
  const filterKeys = ['ruleFilter','groupFilter','partyFilter','from','to','minScore','maxScore','failures'];
  for (const key of [...filterKeys,'breakdown','sort']) {
    listen('outcome-'+key,event=>{
      const value = key==='failures' ? event.target.checked : event.target.value;
      if (value==='') delete outcomeFilters[key];
      else outcomeFilters[key]=value;
      if (key==='sort') {outcomePage=0;renderResults();}
      else refresh();
    },'change');
  }
  listen('clearOutcomeFilters',()=>{
    for (const key of filterKeys) delete outcomeFilters[key];
    ruleOutcomes();
    byId('outcome-ruleFilter').focus();
  });
  listen('exportOutcomes',()=>download(sortedResults().map(item=>[item.rule,...values(item,false)]),headers,'relatovue-executed-rule-outcomes.csv'));
  listen('exploreOutcomes',()=>{
    const rows = new Set(sortedResults().map(item=>item.row));
    drill('Filtered rule outcomes',row=>rows.has(row));
  });
  listen('exportPopulationSummary',()=>download(breakdown.map(groupValues),groupHeaders(),'relatovue-outcome-breakdown.csv'));
  listen('populationResults',event=>{
    const button = event.target.closest('button[data-population]');
    if (button) {
      selectGroup(breakdown[Number(button.dataset.population)]);
      byId('outcome-sort').focus();
    }
  });
  listen('outcomeCharts',event=>{
    const button = event.target.closest('button[data-group-index], button[data-bucket-index]');
    if (!button) return;
    const {groupIndex,bucketIndex} = button.dataset;
    selectGroup(groupIndex===undefined ? buckets[Number(bucketIndex)] : breakdown[Number(groupIndex)]);
    byId('outcome-sort').focus();
  });
  refresh();
}
function outcomeRankingChart(groups, groupBy) {
  const byRule = groupBy==='rule';
  const metric = byRule ? 'maxInvalid' : 'failed';
  const title = byRule ? 'Largest invalid counts by rule' : {
    population:'Failed rules by population',party:'Failed rules by party type',date:'Failed rules by date'
  }[groupBy];
  const visible = groups.slice(0,6).filter(group=>group[metric]>0);
  const leading = visible.length>1 && visible[0][metric]>visible[1][metric];
  const detail = byRule ? 'Largest count in a single reported outcome.' : 'Distinct failed rules within each group.';
  return '<section class="outcome-visual"><h3>'+title+'</h3><p>'+detail+'</p>'+
    (visible.length?'<div class="outcome-ranking">'+visible.map((group,index)=>{
      const value = number.format(group[metric]);
      const label = outcomeGroupLabel(group);
      return '<button type="button" class="outcome-rank'+(index===0 && leading?' leading':'')+'" data-group-index="'+index+'" aria-label="'+
        html(label+', '+value+(byRule?' invalid records':' failed rules'))+'"><span>'+html(label)+'</span><strong>'+value+
        '</strong><span class="track" aria-hidden="true"><span style="width:'+group[metric]/visible[0][metric]*100+'%"></span></span></button>';
    }).join('')+'</div>':'<p class="empty">No failures in the current selection.</p>')+'</section>';
}
function outcomeScoreDistribution(results) {
  const useScore = results.some(item=>item.scoreValue!==null);
  const title = useScore ? 'Reported score distribution' : 'Pass-rate distribution';
  const entries = results.map(item=>[item,useScore?item.scoreValue:item.rate===null?null:item.rate*100])
    .filter(([,value])=>value!==null);
  if (!entries.length) return {title,buckets:[],count:0};
  let min = Infinity, max = -Infinity;
  for (const [,value] of entries) {
    min = Math.min(min,value);
    max = Math.max(max,value);
  }
  const size = min===max ? 1 : 5;
  const formatScore = value=>scoreNumber.format(value)+(useScore?'':'%');
  const buckets = Array.from({length:size},(_,index)=>{
    const fraction = index/size, next = (index+1)/size;
    const lower = min*(1-fraction)+max*fraction;
    const upper = min*(1-next)+max*next;
    const label = size===1 ? formatScore(lower) : formatScore(lower)+(index===size-1?' to ':' to under ')+formatScore(upper);
    return {label,tick:formatScore(lower),upper,outcomes:[]};
  });
  for (const [item,value] of entries) {
    const bucket = buckets.find(candidate=>value<candidate.upper) ?? buckets.at(-1);
    bucket.outcomes.push(item);
  }
  return {title,buckets,count:entries.length,min:formatScore(min),max:formatScore(max)};
}
function outcomeScoreChart({title,buckets,count,min,max}) {
  const header = '<section class="outcome-visual"><h3>'+title+'</h3>';
  if (!count) return header+'<p class="empty">No scores or assessed outcomes in this selection.</p></section>';
  const largest = Math.max(...buckets.map(bucket=>bucket.outcomes.length));
  return header+'<p>'+number.format(count)+(count===1?' outcome':' outcomes')+' · '+html(min===max?min:min+' to '+max)+'</p>'+
    '<div class="outcome-histogram" style="--bucket-count:'+buckets.length+'">'+buckets.map((bucket,index)=>{
      const count = bucket.outcomes.length;
      return '<button type="button" data-bucket-index="'+index+'"'+(count?'':' disabled')+' aria-label="'+
        html(bucket.label+', '+number.format(count)+(count===1?' outcome':' outcomes'))+'" title="'+html(bucket.label)+'">'+
        '<span class="outcome-histogram-plot" aria-hidden="true"><span style="--bar-height:'+count/largest*100+'%">'+
        (count?'<strong>'+number.format(count)+'</strong>':'')+'</span></span><span class="outcome-histogram-tick">'+html(bucket.tick)+'</span></button>';
    }).join('')+'</div></section>';
}
function filterOutcomeRows(results, filters) {
  const {ruleFilter,groupFilter,partyFilter,from,to,minScore,maxScore,failures} = filters;
  return results.filter(item=>(!ruleFilter || dataProfile.outcomeIdentity(item)===ruleFilter) &&
    (!groupFilter || item.group===groupFilter) && (!partyFilter || item.party===partyFilter) &&
    ((!from && !to) || (item.date && (!from || item.date>=from) && (!to || item.date<=to))) &&
    (minScore===undefined || (item.scoreValue!==null && item.scoreValue>=Number(minScore))) &&
    (maxScore===undefined || (item.scoreValue!==null && item.scoreValue<=Number(maxScore))) &&
    (!failures || item.invalid>0));
}
function profile(reportedOnly = false) {
  const rows = scopedRows();
  const report = reportedOnly ? dataProfile.evaluateReported(dataset.columns,rows) :
    dataProfile.evaluate(dataset.columns,rows,profileSettings);
  const {fields,byDimension,reported,inferredKey} = report;
  const dims = dataProfile.dimensions;
  const allRules = Object.values(byDimension).flat();
  const bindings = [];
  const freshness = profileSettings.freshness;
  const dateFields = fields.filter(field=>field.dateRange || field.index===freshness?.field);
  const suggestedDate = (dateFields.find(field=>/(?:updated|modified|refresh|ingest|loaded)/.test(field.key)) ?? dateFields[0])?.index;
  const controls = reported ? {} : {
    Accuracy:'<div class="profile-setup"><p>Choose a trusted reference file and map its join key and comparison field.</p>'+
      action(referenceFile?'Change reference file':'Choose reference CSV or TSV','chooseReference')+
      (referenceFile?'<p class="reference-name">'+html(referenceFile.name)+'</p>':'')+
      '<p id="referenceStatus" role="status"></p>'+referenceOptions(fields)+'</div>',
    Timeliness:dateFields.length ? '<div class="profile-setup"><form class="profile-controls" id="freshnessForm">'+
      fieldSelect('freshnessField','Date field',dateFields,freshness?.field ?? suggestedDate)+
      '<label for="freshnessDays">Maximum age (days)<input id="freshnessDays" type="number" min="0" max="36500" step="1" required value="'+html(freshness?.days ?? '')+'"></label>'+
      '<label for="freshnessDate">As of (UTC)<input id="freshnessDate" type="date" required value="'+html(freshness?.asOf ?? new Date().toISOString().slice(0,10))+'"></label>'+
      '<button class="btn primary" type="submit">Run freshness check</button>'+
      (freshness?action('Clear check','clearFreshness'):'')+'</form></div>' : '',
    Uniqueness:'<div class="profile-setup"><form class="profile-controls" id="uniquenessForm">'+
      fieldSelect('profileKey','Record key',[{index:-1,name:'No key'},...fields],profileSettings.key ?? inferredKey)+
      '<button class="btn" type="submit">Apply key</button></form></div>'
  };
  const pending = reported ? {} : {
    Accuracy:'Not assessed. An authoritative reference is required.',
    Timeliness:dateFields.length ? 'Not assessed. Set the maximum acceptable age for the selected field.' : 'Not assessed. No usable ISO date or timestamp values were found.',
    Consistency:'No supported cross-field or category consistency rules were inferred.',
    Validity:'No supported type or format rules were inferred from the populated values.'
  };
  const ruleTable = (name,rules) => {
    if (!rules.length) return '<p class="profile-empty">'+html(pending[name]||'No rule outcomes are available for this dimension.')+'</p>';
    const count = (outcome,property,matcher,label)=>{
      const total = outcome[property];
      if (!total) return '0';
      const id = 'ruleDetail'+bindings.length;
      bindings.push([id,name+' · '+outcome.name+' · '+label,matcher]);
      return '<button id="'+id+'" aria-label="'+html('View source rows for '+outcome.name+' · '+label)+'">'+number.format(total)+'</button>';
    };
    return '<div class="scroll"><table class="rule-table"><thead><tr><th scope="col">Rule</th><th scope="col">Outcome</th>'+
      '<th scope="col">Passed</th><th scope="col">Failed</th><th scope="col">Not assessed</th><th scope="col">Pass rate</th></tr></thead><tbody>'+
      rules.map(outcome=>'<tr><td><strong>'+html(outcome.name)+'</strong><small>'+html(outcome.origin+' · '+outcome.unit)+'</small><small>'+html(outcome.criterion)+'</small>'+(outcome.excluded?'<small>'+number.format(outcome.excluded)+' source rows excluded for invalid counts.</small>':'')+'</td>'+
        '<td><span class="rule-status'+(outcome.failed?' failed':outcome.passed?' passed':'')+'">'+resultLabel(outcome)+'</span></td>'+
        '<td>'+number.format(outcome.passed)+'</td><td>'+count(outcome,'failed',outcome.failure,'Failures')+'</td><td>'+
        count(outcome,'skipped',outcome.notAssessed,'Not assessed')+'</td><td>'+passRate(outcome)+'</td></tr>').join('')+'</tbody></table></div>';
  };
  const range = field=>{
    const values = field.type==='Date/time' ? field.dateRange : field.type==='Number' ? field.numericRange : null;
    if (!values) return '—';
    return values[0]===values[1] ? String(values[0]) : values.join(' to ');
  };
  const stats = [
    ['Source rows',rows.length],...(!reportedOnly?[['Fields',fields.length]]:[]),['Rules with results',allRules.filter(rule=>rule.passed||rule.failed).length],
    ['Rules with failures',allRules.filter(rule=>rule.failed).length]
  ];
  const description = reported ? 'Review the rule outcomes supplied by this source.' : 'Review field statistics and rule outcomes across six data quality dimensions.';
  byId('dashboardProfile').innerHTML = '<div class="toolbar"><div><h2>'+(reportedOnly?'Reported checks':'Data profile')+
    '</h2><p class="subtle">'+html(description)+'</p></div>'+action('Export rule outcomes ↓','exportProfile')+'</div>'+
    '<div class="profile-meta"><p>'+html(windowSize==='all'?'All loaded records.':'Current report date filter applies.')+' '+
    html(reported?'Pass rate excludes checks marked not assessed. Select a failed or not-assessed count to see the source result rows.':
      'Inferred rules are candidates for review. Pass rate excludes records that could not be assessed.')+'</p>'+
    (reported?.unmapped.size ? '<p>'+number.format(reported.unmapped.size)+' rows have an unmapped dimension or missing rule name. '+action('View rows','unmappedOutcomes')+'</p>':'')+
    (reported?.unrecognized.size ? '<p>'+number.format(reported.unrecognized.size)+' rows have an unrecognized status or invalid counts. '+action('View rows','invalidOutcomes')+'</p>':'')+'</div>'+
    '<div class="profile-stats">'+stats.map(([label,value])=>'<div><strong>'+number.format(value)+'</strong><span>'+label+'</span></div>').join('')+'</div>'+
    '<nav class="profile-nav" aria-label="Data quality dimensions">'+dims.map(([name])=>'<a href="#profile-'+name.toLowerCase()+'">'+name+'</a>').join('')+'</nav>'+
    (reportedOnly?'':'<section class="panel profile-section"><h3 class="sectiontitle">Field profile</h3><div class="scroll"><table><thead><tr>'+
    '<th scope="col">Field</th><th scope="col">Observed type</th><th scope="col">Populated</th><th scope="col">Missing</th>'+
    '<th scope="col">Distinct populated values</th><th scope="col">Observed range</th></tr></thead><tbody>'+
    fields.map(field=>'<tr><td>'+html(field.name)+'</td><td>'+field.type+'</td><td>'+number.format(field.populated)+'</td><td>'+
      number.format(rows.length-field.populated)+'</td><td>'+number.format(field.distinct)+'</td><td>'+html(range(field))+'</td></tr>').join('')+
    '</tbody></table></div></section>')+
    dims.map(([name,description])=>{
      const rules = byDimension[name];
      const failed = rules.filter(rule=>rule.failed).length;
      return '<section class="panel profile-section" id="profile-'+name.toLowerCase()+'"><div class="panelhead"><div><h2 class="sectiontitle">'+name+
        '</h2><p>'+description+'</p></div><span class="rule-summary">'+(rules.length?rules.length+' rules · '+failed+' with failures':'Not assessed')+
        '</span></div>'+ruleTable(name,rules)+(controls[name]||'')+'</section>';
    }).join('');
  bindings.forEach(([id,label,match])=>listen(id,()=>drill(label,match)));
  if (reported) {
    listen('unmappedOutcomes',()=>drill('Unmapped rule outcomes',row=>reported.unmapped.has(row)));
    listen('invalidOutcomes',()=>drill('Unrecognized rule outcomes',row=>reported.unrecognized.has(row)));
  }
  listen('exportProfile',()=>{
    const headers = ['Dimension','Rule','Origin','Criterion','Unit','Passed','Failed','Not assessed','Pass rate','Outcome'];
    const results = dims.flatMap(([name])=>byDimension[name].length ?
      byDimension[name].map(rule=>[name,rule.name,rule.origin,rule.criterion,rule.unit,rule.passed,rule.failed,rule.skipped,passRate(rule),resultLabel(rule)]) :
      [[name,'','','','','','','','','Not assessed']]);
    download(results,headers,'relatovue-rule-outcomes.csv');
  });
  if (!reportedOnly) bindProfileControls();
}
function bindProfileControls() {
  const rerender = id=>{
    const heading = byId('profile-'+id);
    const scroll = heading?.getBoundingClientRect().top;
    render();
    if (scroll !== undefined) {
      const updated = byId('profile-'+id);
      window.scrollBy(0,updated.getBoundingClientRect().top-scroll);
      const title = updated.querySelector('h2');
      title.tabIndex = -1;
      title.focus({preventScroll:true});
    }
  };
  listen('chooseReference',()=>{
    const input = byId('referenceUpload');
    input.value = '';
    input.click();
  });
  listen('accuracyForm',e=>{
    e.preventDefault();
    profileSettings.accuracy = {
      reference:referenceFile,
      sourceKey:Number(byId('sourceKey').value), referenceKey:Number(byId('referenceKey').value),
      sourceField:Number(byId('sourceField').value), referenceField:Number(byId('referenceField').value)
    };
    rerender('accuracy');
  },'submit');
  listen('freshnessForm',e=>{
    e.preventDefault();
    profileSettings.freshness = {
      field:Number(byId('freshnessField').value),days:Number(byId('freshnessDays').value),asOf:byId('freshnessDate').value
    };
    rerender('timeliness');
  },'submit');
  listen('uniquenessForm',e=>{
    e.preventDefault();
    profileSettings.key = Number(byId('profileKey').value);
    rerender('uniqueness');
  },'submit');
  listen('clearFreshness',()=>{delete profileSettings.freshness;rerender('timeliness');});
  listen('clearAccuracy',()=>{delete profileSettings.accuracy;rerender('accuracy');});
}
function setStatus(message='', isError=false) {
  const status = byId('loadStatus');
  status.textContent = message;
  status.classList.toggle('error',isError);
}
function chooseFile() {
  const input = byId('upload');
  input.value = '';
  input.click();
}
function openSample(sample) {
  requestId++;
  setStatus();
  applyData(sample);
}
function sourceButtons() {
  const configured = sources.filter(source=>source.configured);
  const setup = '<p>Connect to PostgreSQL, MySQL, or Oracle and choose a table or view.</p>'+
    action('Set up a connection','databaseSetup',true);
  return setup+(configured.length?'<p class="saved-queries">Configured reporting queries</p><ul class="database-list">'+configured.map(({id,name})=>
    '<li><button class="btn" id="source-'+html(id)+'">Load '+html(name)+'</button></li>').join('')+'</ul>':'');
}
function start() {
  byId('app').innerHTML = hero('Reporting studio','Open a data source')+
    '<div class="sourcegrid"><section class="panel"><h2 class="sectiontitle">Upload a file</h2><p>CSV or TSV with column headers, up to 10 MB.</p>'+
    action('Choose a file','choose',true)+'</section><section class="panel"><h2 class="sectiontitle">Connect to a database</h2>'+
    sourceButtons()+'</section><section class="panel"><h2 class="sectiontitle">Try sample data</h2>'+
    '<div class="filters">'+action('Sales records','sampleSales')+action('Data quality outcomes','sampleOutcomes')+'</div></section></div>';
  listen('choose',chooseFile);
  listen('sampleSales',()=>openSample(demo));
  listen('sampleOutcomes',()=>openSample(outcomeDemo));
  listen('databaseSetup',()=>{
    setStatus();
    return databaseWizard.open(next=>loadSource(next.name,()=>Promise.resolve(next)));
  });
  sources.filter(source=>source.configured).forEach(({id,name})=>listen('source-'+id,()=>loadSource(name,async()=>{
    const response = await fetch('/api/datasets/'+encodeURIComponent(id),{cache:'no-store'});
    if (!response.ok) { const error=await response.json().catch(()=>({})); throw Error(error.error||'Reporting query failed.'); }
    return await response.json();
  })));
}
async function loadSource(name,read) {
  const id = ++requestId;
  setStatus('Loading '+name+'…');
  try {
    const next = await read();
    if (id !== requestId) return;
    applyData(next);
    setStatus('Loaded '+name+' · '+number.format(next.rows.length)+' source rows.');
  } catch(error) {
    if (id === requestId) setStatus('Could not load '+name+'. '+error.message,true);
  }
}
function detectedMode() {
  if (dataProfile.validOutcomeMapping(outcomeMapping,derivePopulation())) return 'outcomes';
  if (dataProfile.reportedFields(dataset.columns)) return 'reported';
  if ((outcomeMapping.rule>=0 || outcomeMapping.population>=0) &&
      (outcomeMapping.valid>=0 || outcomeMapping.invalid>=0 || outcomeMapping.score>=0)) return 'outcomes';
  return 'raw';
}
function reportMode() {
  return datasetMode==='auto' ? detectedMode() : datasetMode;
}
function dashboard() {
  const mode = reportMode();
  const labels = {raw:'Raw records',outcomes:'Data quality outcomes',reported:'Reported checks',aggregate:'Aggregate data'};
  const sectionLinks = mode==='raw' ? [['dashboardPerformance','Performance'],['dashboardProfile','Data profile']] :
    mode==='outcomes' && dataProfile.validOutcomeMapping(outcomeMapping,derivePopulation()) ?
      [['outcomeFilters','Outcome filters'],['outcomeBreakdown','Breakdown'],['outcomeDetails','Reported results']] :
    mode==='reported' ? [['dashboardProfile','Reported checks']] : [];
  byId('app').innerHTML = hero(dataset.source,dataset.name,labels[mode],action('Explore records ↗','heroExplore',true))+
    '<div class="toolbar"><div><h2>Dataset overview</h2><p class="subtle">'+number.format(dataset.rows.length)+' source rows · '+
    number.format(dataset.columns.length)+' columns</p></div><label>Data type <select id="datasetMode">'+
    options([['auto','Auto · '+labels[detectedMode()]],...Object.entries(labels).filter(([key])=>key!=='reported')],datasetMode)+
    '</select></label></div>'+
    (sectionLinks.length?'<nav class="profile-nav" aria-label="Dashboard sections">'+sectionLinks.map(([id,label])=>'<a href="#'+id+'">'+label+'</a>').join('')+'</nav>':'')+
    '<section id="dashboardPerformance"></section><section id="dashboardProfile"></section><section id="dashboardOutcomes"></section>';
  listen('heroExplore',()=>navigate('Explore records'));
  listen('datasetMode',event=>{
    datasetMode=event.target.value;
    windowSize='all';
    assistantFilter=null;
    assistantAscending=false;
    outcomeFilters={};
    assistantVersion++;
    render();
    byId('datasetMode').focus();
  },'change');
  if (mode==='raw') {
    performance();
    profile();
  } else if (mode==='outcomes') ruleOutcomes();
  else if (mode==='reported') profile(true);
  else {
    const rows=dataset.rows.slice(0,5);
    byId('dashboardPerformance').innerHTML='<section class="panel tablepanel"><div class="panelhead"><h3>Source preview</h3></div>'+table(rows)+'</section>';
    bindRows(rows);
  }
}
function render() {
  const visible = dataset ? pages : pages.slice(0,1);
  byId('nav').innerHTML = visible.map(([name,icon],i)=>'<button id="nav'+i+'" aria-current="'+(view===name)+'"><i aria-hidden="true">'+icon+'</i>'+name+'</button>').join('');
  visible.forEach(([name],i)=>listen('nav'+i,()=>{navigate(name);byId('nav'+i).focus();}));
  byId('crumb').textContent=view;
  byId('badge').textContent=dataset?.source || 'No source loaded';
  byId('assistantPanel').hidden = false;
  byId('assistantClear').hidden = !assistantFilter && windowSize==='all';
  byId('replace').hidden = !dataset || view === 'Start';
  ({Start:start,Dashboard:dashboard,'Explore records':explore})[view]();
  if (dataset?.truncated && view!=='Start') byId('app').insertAdjacentHTML('beforeend','<p class="notice" role="status">Showing '+number.format(dataset.rowLimit??10000)+' rows. The source returned more rows than the selected limit.</p>');
}
function fileDelimiter(text,filename) {
  const candidates = /\.tsv$/i.test(filename) ? ['\t',',',';'] : [',',';','\t'];
  const counts = new Map(candidates.map(value=>[value,0]));
  let quoted = false, started = false;
  for (const ch of text) {
    if (!started && /\s/.test(ch) && !counts.has(ch)) continue;
    started = true;
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === '\n' || ch === '\r')) break;
    if (!quoted && counts.has(ch)) counts.set(ch,counts.get(ch)+1);
  }
  return candidates.reduce((best,value)=>counts.get(value)>counts.get(best)?value:best);
}
function parseFile(text, delimiter) {
  const records=[];
  let record=[], field='', state='start', hasContent=false;
  const finish = () => {
    if (hasContent || record.length) records.push([...record,field]);
    record=[]; field=''; state='start'; hasContent=false;
  };
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(state==='quoted'){
      if(ch==='"' && text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"') state='closed';
      else field+=ch;
    } else if(ch===delimiter){
      record.push(field); field=''; state='start'; hasContent=true;
    } else if(ch==='\n' || ch==='\r'){
      if(ch==='\r' && text[i+1]==='\n') i++;
      finish();
    } else if(ch==='"' && (state==='start' || (state==='plain' && !field.trim()))) {
      field=''; state='quoted'; hasContent=true;
    } else if(state==='closed' && /[ \t]/.test(ch)){
      continue;
    } else {
      if(state==='closed' || ch==='"') throw Error('Check the quoting in record '+(records.length+1)+'.');
      field+=ch; state='plain'; hasContent ||= !/\s/.test(ch);
    }
  }
  if(state==='quoted') throw Error('Record '+(records.length+1)+' contains an unclosed quoted field.');
  finish();
  const [header,...rows]=records;
  if(!header?.length || !rows.length) throw Error('Include a header and at least one record.');
  const columns=header.map(value=>value.trim());
  if(columns.some(blank) || new Set(columns).size!==columns.length) throw Error('Use unique, nonempty column names.');
  const mismatch = rows.findIndex(row=>row.length!==columns.length);
  if(mismatch>=0) throw Error('Record '+(mismatch+2)+' has '+rows[mismatch].length+' fields. The header has '+columns.length+'.');
  return {columns,rows};
}
function download(rows,columns=dataset.columns,filename='relatovue-records.csv') {
  const escape = value => {
    const original=String(value??'');
    const safe=/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(original)&&!numeric(original)?"'"+original:original;
    return '"'+safe.replace(/"/g,'""')+'"';
  };
  const csv=[columns,...rows].map(row=>row.map(escape).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url; link.download=filename; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function readFlatFile(file) {
  if(file.size>10*1024*1024) throw Error('Choose a file no larger than 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0]===255 && bytes[1]===254 ? 'utf-16le' :
    bytes[0]===254 && bytes[1]===255 ? 'utf-16be' : 'utf-8';
  let raw;
  try {
    raw = new TextDecoder(encoding,{fatal:true}).decode(bytes);
  } catch {
    throw Error('Save the file as UTF-8 or UTF-16 and try again.');
  }
  const delimiter = fileDelimiter(raw,file.name);
  const result = parseFile(raw,delimiter);
  return {...result,name:file.name,source:delimiter==='\t'?'TSV file':'CSV file'};
}
function assistantContext() {
  const measures = schema.filter(field=>field.numeric).map(field=>field.name);
  const dimensions = schema.filter(field=>!field.date).map(field=>field.name);
  const groups = Object.create(null);
  for (const field of schema.filter(item=>item.category)) {
    groups[field.name] = [...new Set(dataset.rows.filter(row=>!blank(row[field.index])).map(row=>String(row[field.index])))];
  }
  return {measures,dimensions,groups,months:dateKeys()};
}
function applyAssistantResult(result) {
  const mode = reportMode();
  if (mode==='outcomes') {
    if (result.action!=='explain' && result.action!=='quality') return 'Use the outcome filters and breakdown on the dashboard to compare reported results.';
    const derived = derivePopulation();
    if (!dataProfile.validOutcomeMapping(outcomeMapping,derived)) return 'Map the rule name and count columns first.';
    const results = filterOutcomeRows(dataProfile.readOutcomes(scopedRows(),outcomeMapping,derived).results,outcomeFilters);
    if (!results.length) return 'There are no usable rule outcomes in the current report scope.';
    const {rules,failed} = dataProfile.summarizeOutcomes(results);
    const worst = results.reduce((first,item)=>item.invalid>first.invalid ? item : first);
    return number.format(failed)+' failed out of '+number.format(rules)+' distinct rules across '+
      number.format(results.length)+' reported outcomes.'+(failed?' '+worst.rule+' had the largest invalid count in one outcome ('+
        number.format(worst.invalid)+').':'');
  }
  if (mode==='aggregate' || (mode==='reported' && result.action!=='quality')) {
    return dataset.name+' contains '+number.format(dataset.rows.length)+' source rows.';
  }
  if (result.action==='explain') {
    const rows=scopedRows();
    const label=metricLabel();
    const total=rows.reduce((sum,row)=>sum+amount(row),0);
    return dataset.name+' · '+number.format(rows.length)+' records in scope · '+label+': '+format(total)+
      (dimension>=0?' · grouped by '+dataset.columns[dimension]:'')+'.';
  }
  if (result.action==='quality') {
    const report=mode==='reported' ? dataProfile.evaluateReported(dataset.columns,scopedRows()) :
      dataProfile.evaluate(dataset.columns,scopedRows(),profileSettings);
    const dimensionName=dataProfile.dimensions.find(([name])=>name.toLowerCase()===result.dimensionName)?.[0];
    const rules=(dimensionName?report.byDimension[dimensionName]:Object.values(report.byDimension).flat());
    const failures=rules.filter(rule=>rule.failed).sort((a,b)=>b.failed-a.failed);
    navigate('Dashboard',dimensionName?'profile-'+dimensionName.toLowerCase():'dashboardProfile');
    if (!rules.some(rule=>rule.passed||rule.failed)) return 'No rules were assessed in this scope.';
    if (!failures.length) return 'No failures among the assessed rules in this scope.';
    return number.format(failures.length)+' rules with failures. '+failures.slice(0,3)
      .map(rule=>rule.name+': '+number.format(rule.failed)+' failed '+rule.unit).join('; ')+'. Select a failure count to inspect the source rows.';
  }
  measure=result.measure;
  dimension=result.dimension;
  windowSize=String(result.period||'all');
  assistantFilter=null;
  assistantAscending=false;
  if (result.chart==='line'||result.chart==='column') timeChart=result.chart==='line'?'line':'bar';
  if (result.chart==='bar'||result.chart==='donut') groupChart=result.chart;
  if (result.chart==='table') {
    groupChart='table';
    timeChart='table';
  }
  let answer;
  if (result.action==='rank') {
    assistantFilter=result.match;
    assistantAscending=result.lowest;
    groupChart='bar';
    const winners=result.leaders.map(([name])=>name).join(', ');
    answer=winners+' '+(result.leaders.length>1?'tied for ':'had the ')+(result.lowest?'lowest':'highest')+' '+result.label+
      ' ('+format(result.leaders[0][1])+')'+(result.months?' from '+result.months[0]+' through '+result.months[2]:' in the loaded dataset')+
      (result.status?', using won records only':'')+'.';
  } else if (result.entries) {
    if(result.groups) {
      const index=dimension, selected=new Set(result.groups);
      assistantFilter=row=>!blank(row[index])&&selected.has(String(row[index]));
      groupChart='bar';
    } else {
      const index=dateField, selected=new Set(result.months);
      assistantFilter=row=>selected.has(dateMonth(row[index]));
      timeChart='line';
    }
    const change=result.entries[1][1]-result.entries[0][1];
    answer=result.label+' · '+result.entries.map(([key,value])=>key+': '+format(value)).join(' · ')+
      ' · Difference (second minus first): '+format(change)+'.';
    if(change!==0 && result.contributor) answer+=' Largest contribution in the direction of change: '+result.contributor[0]+' ('+format(result.contributor[1])+').';
  } else {
    answer=result.label+': '+format(result.total)+' across '+number.format(result.count)+' records'+
      (result.period?' in the last '+result.period+' observed months':' in the loaded dataset')+'.';
    if (result.chart==='donut') {
      const totals=aggregate(scopedRows(),groupKey).map(([,value])=>value);
      if (!totals.some(value=>value>0)||totals.some(value=>value<0)) answer+=' Showing bars because these totals cannot be shown as a donut.';
    }
  }
  navigate('Dashboard','dashboardPerformance');
  return answer+' Select a chart item to inspect its records.';
}

listen('assistantClear',()=>{
  assistantVersion++;
  assistantFilter=null;
  assistantAscending=false;
  windowSize='all';
  byId('assistantAnswer').textContent='Assistant scope cleared.';
  render();
});
function chatMessage(role,text) {
  const log=byId('assistantHistory');
  const entry=document.createElement('p');
  entry.className=role==='You'?'chat-user':'chat-answer';
  entry.textContent=role+' · '+text;
  log.append(entry);
  log.scrollTop=log.scrollHeight;
}
const providerNames={copilot:'Microsoft Copilot Studio',ollama:'Ollama',gemini:'Gemini',claude:'Claude',grok:'Grok',openai:'OpenAI',local:'Local OpenAI-compatible agent'};
const extraSetup=Object.fromEntries(['gemini','claude','grok','openai','local'].map(provider=>[provider,[
  provider==='local'?'Start your local runtime with its OpenAI-compatible chat endpoint enabled on this computer. Reply “next”.':
    'Obtain an approved '+providerNames[provider]+' API key and a supported API model ID. Keep the key out of chat. Reply “next”.',
  'Set RELATOVUE_AI_PROVIDER='+provider+' and RELATOVUE_AI_MODEL to the exact model ID in the RelatoVue server environment. '+
    (provider==='local'?'Set RELATOVUE_LOCAL_AI_PORT if your endpoint uses a port other than 1234. Set RELATOVUE_AI_KEY only if your local runtime requires it.':
      'Set RELATOVUE_AI_KEY through your approved secret manager.')+' Reply “next”.'
]]));
const setupGuides={
  ...extraSetup,
  copilot:[
    'Publish your agent in Microsoft Copilot Studio. Enable a Direct Line-capable channel and obtain its server-side Direct Line secret. Reply “next” when ready.',
    'Configure the agent to return RelatoVue report-plan JSON, using the contract in the README and server.py. For example: {"action":"report","measure":"Revenue","dimension":"Region","chart":"bar"}. Reply “next”.',
    'Set RELATOVUE_COPILOT_SECRET in the environment that launches RelatoVue. For a regional agent also set RELATOVUE_COPILOT_REGION to europe or india as appropriate. Keep the secret out of this chat. Reply “next”.'
  ],
  ollama:[
    'Install and start Ollama on this computer. The RelatoVue adapter uses the local Ollama chat API on port 11434. Reply “next” when it is running.',
    'Make your chosen model available in Ollama and run “ollama list” to find its exact model tag. Set RELATOVUE_OLLAMA_MODEL to that tag in the environment that launches RelatoVue. Reply “next”.'
  ]
};
const setupFinish='Restart python server.py from that environment, reopen RelatoVue at its local server URL, and type “check” followed by the provider name here. You can run that check even after a reload.';
function setupStep() {
  const {provider,index}=assistantSetup;
  const steps=setupGuides[provider];
  const instruction=steps[index]||setupFinish;
  chatMessage('Setup','Step '+(index+1)+' of '+(steps.length+1)+' · '+instruction);
}
async function handleAssistantSetup(question) {
  const q=question.toLowerCase().trim();
  const start=q.match(/^connect\s+to(?:\.{3}|\s)+(.+)$/);
  const check=q.match(/^(?:check|test)(?:\s+connection\s+to)?\s+(.+)$/);
  const providerFrom=name=>/\b(copilot|ollama|gemini|claude|grok|lm studio|local|openai|chatgpt)\b/.exec(name)?.[1]?.replace(/^(lm studio)$/,'local').replace(/^chatgpt$/,'openai');
  if (start) {
    const provider=providerFrom(start[1]);
    if (!provider) {
      chatMessage('Setup','Choose Copilot Studio, Gemini, Claude, Grok, OpenAI, Ollama, or a local OpenAI-compatible runtime. For LM Studio or another compatible runtime, type “connect to local agent”.');
      return true;
    }
    assistantSetup={provider,index:0};
    setupStep();
    return true;
  }
  const active=assistantSetup;
  if (active && /^(cancel|exit|stop)( setup)?$/.test(q)) {
    assistantSetup=null;
    chatMessage('Setup','Setup guide closed.');
    return true;
  }
  if (active && /^(next|done|ready|back|repeat)$/.test(q)) {
    const last=setupGuides[active.provider].length;
    if(q==='back') active.index=Math.max(0,active.index-1);
    else if(q!=='repeat') active.index=Math.min(last,active.index+1);
    setupStep();
    return true;
  }
  const provider=check?providerFrom(check[1]):active&&/^(check|test|verify)$/.test(q)?active.provider:null;
  if (!provider) {
    if (!active) return false;
    chatMessage('Setup','Reply “next”, “back”, “repeat”, “check”, or “cancel”. Enter credentials in the server environment only.');
    return true;
  }
  if (location.protocol==='file:') {
    chatMessage('Setup','Start python server.py and open http://127.0.0.1:8765/ to test the connection.');
    return true;
  }
  const version=assistantVersion;
  byId('assistantAnswer').textContent='Testing the configured provider…';
  let message;
  try {
    const statusResponse=await fetch('/api/assistant/status',{cache:'no-store'});
    if (!statusResponse.ok) throw Error();
    const status=await statusResponse.json();
    copilotConfigured=status.copilotConfigured===true;
    modelEnabled=status.modelEnabled===true;
    externalProvider=status.externalProvider||null;
    const configured=provider==='copilot'?copilotConfigured:provider==='ollama'?modelEnabled:externalProvider===provider;
    const selected=copilotConfigured?'copilot':externalProvider||(modelEnabled?'ollama':null);
    if (!configured) {
      message=providerNames[provider]+' is not configured in the running server. Type “connect to '+provider+'” to review the setup steps.';
    } else if (provider!==selected) {
      message=providerNames[selected]+' currently takes priority. Remove its configuration from the server environment and restart before testing '+providerNames[provider]+'.';
    } else {
      const response=await fetch('/api/assistant/plan',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question:'Connection check',connectionTest:true,measures:[],dimensions:[],months:[]})});
      const result=await response.json().catch(()=>({}));
      if (!response.ok) throw Error(result.error || '');
      if (result.action!=='explain') throw Error('The provider replied, but did not return the expected test plan.');
      message=providerNames[provider]+' returned the expected test response. Load a dataset and ask a report question.';
      if(version===assistantVersion) {
        assistantSetup=null;
        byId('assistantProvider').textContent=provider==='copilot'?'Powered by Microsoft Copilot':'Report engine · '+providerNames[provider]+' available';
      }
    }
  } catch(error) {
    message=error.message || 'The connection test failed or returned an unexpected plan. Verify that the agent or model is running, then check its setup and try again.';
  }
  if(version===assistantVersion) {
    byId('assistantAnswer').textContent='';
    chatMessage('Setup',message);
  }
  return true;
}
listen('assistantForm',async event=>{
  event.preventDefault();
  const question=byId('assistantQuestion').value.trim();
  if(!question) return;
  const setupCommand=/^(connect\s+to|check|test|next|done|ready|back|repeat|cancel|exit|stop|verify)\b/i.test(question);
  if(!assistantSetup||setupCommand) chatMessage('You',question);
  byId('assistantQuestion').value='';
  const version=++assistantVersion, startingView=view;
  byId('assistantAnswer').textContent='';
  if(await handleAssistantSetup(question) || version!==assistantVersion) return;
  if(!dataset) {
    chatMessage('RelatoVue','Load a dataset to ask analytical questions. To configure an agent, type “connect to Copilot Studio” or “connect to Ollama”.');
    return;
  }
  if (reportMode()==='outcomes' || reportMode()==='aggregate') {
    const context = {measures:[],dimensions:[],groups:{},months:[]};
    const request = reportAssistant.plan(question,context);
    const result = request?.action==='explain' || request?.action==='quality' ? request : {action:'compare'};
    chatMessage('RelatoVue',applyAssistantResult(result));
    return;
  }
  const context=assistantContext();
  const answer=byId('assistantAnswer');
  const local=reportAssistant.validate(reportAssistant.plan(question,context),context);
  let plan=local;
  let mode='Report engine';
  let modelUnavailable=false;
  const blocked=/\b(delete|drop|truncate|password|credentials|insert|execute sql|update the database|send|upload|export all)\b/i.test(question);
  if (!blocked && (copilotConfigured || (!plan && (modelEnabled || externalProvider)))) {
    answer.textContent=copilotConfigured?'Asking Microsoft Copilot…':'Interpreting the question with '+(providerNames[externalProvider]||'Ollama')+'…';
    try {
      const {groups,...metadata}=context;
      const statusFields=Object.keys(groups).filter(key=>/^(stage|status|outcome)$/i.test(key) &&
        groups[key].some(value=>/^(closed )?won$/i.test(value.trim())));
      const response=await fetch('/api/assistant/plan',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question,...metadata,statusFields,year:new Date().getFullYear(),previous:previousAssistantPlan})});
      if(version!==assistantVersion||view!==startingView) return;
      if(response.ok) {
        const proposed=reportAssistant.validate(await response.json(),context);
        if(version!==assistantVersion||view!==startingView) return;
        if(copilotConfigured) byId('assistantProvider').textContent='Powered by Microsoft Copilot';
        const missingScope=!local && /\b(quarter|maximum|highest|lowest|least|most)\b/i.test(question) && proposed?.action!=='rank';
        const wonScope=/\bwon\b/i.test(question) && proposed?.action==='rank' && !proposed.status;
        const quarterScope=/\bquarter\b/i.test(question) && proposed?.action==='rank' && !proposed.months;
        if(proposed && !missingScope && !wonScope && !quarterScope && (!local || local.action===proposed.action) &&
           (!local || ['measure','dimension','chart','period','lowest'].every(key=>local[key]===undefined||local[key]===proposed[key])) &&
           (!local?.months?.length || JSON.stringify(local.months)===JSON.stringify(proposed.months)) &&
           (!local?.status || local.status===proposed.status)) {
          plan=proposed;
          mode=copilotConfigured?'Microsoft Copilot + report engine':(providerNames[externalProvider]||'Ollama')+' + report engine';
        }
      } else modelUnavailable=true;
    } catch {modelUnavailable=true;}
  }
  if(version!==assistantVersion||view!==startingView) return;
  const result=plan&&reportAssistant.execute(plan,context,dataset.rows,dataset.columns,{measure,dimension,dateField,numeric,month:dateMonth});
  if (result) previousAssistantPlan={action:plan.action,measure:plan.measure,dimension:plan.dimension,chart:plan.chart};
  if (copilotConfigured && modelUnavailable) byId('assistantProvider').textContent='Microsoft Copilot unavailable · Report engine';
  const reply=result?mode+' · '+applyAssistantResult(result):
    (modelUnavailable?'The configured assistant provider is unavailable. ':'')+
    'I couldn’t match that question to the available data and dates. For a quarter, name its ending month and make sure all three months are loaded. The report was left as it was.';
  answer.textContent='';
  chatMessage('RelatoVue',reply);
},'submit');
listen('replace',chooseFile);
listen('upload',e=>{
  const file = e.target.files[0];
  e.target.value = '';
  if (file) loadSource(file.name,()=>readFlatFile(file));
},'change');
listen('referenceUpload',async e=>{
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const request = ++referenceRequest;
  const status = message=>{
    const element = byId('referenceStatus');
    if (element) element.textContent = message;
  };
  status('Loading '+file.name+'…');
  try {
    const reference = await readFlatFile(file);
    if (request !== referenceRequest) return;
    referenceFile = reference;
    delete profileSettings.accuracy;
    if (view === 'Dashboard' && reportMode()==='raw') {
      const top = byId('profile-accuracy').getBoundingClientRect().top;
      render();
      window.scrollBy(0,byId('profile-accuracy').getBoundingClientRect().top-top);
      status('Reference loaded. Choose the fields to compare.');
      byId('sourceKey').focus({preventScroll:true});
    }
  } catch(error) {
    if (request === referenceRequest) status('Could not load '+file.name+'. '+error.message);
  }
},'change');
function captureWorkspace(previous) {
  if (!dataset) return previous;
  const fieldName=index=>dataset.columns[index]??null;
  const settings={...previous};
  if (reportMode()==='raw') {
    Object.assign(settings,{measure:fieldName(measure),dimension:fieldName(dimension),dateField:fieldName(dateField),
      timeChart,groupChart,period:windowSize});
    if (profileSettings.key!==undefined) settings.profileKey=fieldName(profileSettings.key);
    if (profileSettings.freshness) settings.freshness={...profileSettings.freshness,field:fieldName(profileSettings.freshness.field)};
    else delete settings.freshness;
  }
  if (reportMode()==='outcomes' && dataProfile.validOutcomeMapping(outcomeMapping,derivePopulation())) {
    settings.outcomeFields=Object.fromEntries(Object.entries(outcomeMapping).map(([key,index])=>[key,fieldName(index)]));
  }
  return settings;
}
function activateWorkspace(settings) {
  requestId++;
  assistantVersion++;
  referenceRequest++;
  dataset=null;
  workspaceDefaults=settings;
  datasetMode='auto';
  outcomeFilters={};
  assistantFilter=null;
  assistantSetup=null;
  previousAssistantPlan=null;
  assistantAscending=false;
  profileSettings={};
  outcomeMapping={};
  referenceFile=null;
  windowSize='all';
  timeChart=settings.timeChart||'line';
  groupChart=settings.groupChart||'bar';
  byId('assistantHistory').replaceChildren();
  byId('assistantQuestion').value='';
  byId('assistantAnswer').textContent='';
  byId('fields').replaceChildren();
  byId('upload').value='';
  byId('referenceUpload').value='';
  setStatus();
  navigate('Start');
}
if (typeof workspaceMenu!=='undefined') workspaceMenu.init({capture:captureWorkspace,activate:activateWorkspace,saved:settings=>{workspaceDefaults=settings;}});
render();
function refreshServerServices(){
if(location.protocol!=='file:'){
  fetch('/api/assistant/status',{cache:'no-store'}).then(response=>response.ok?response.json():{}).then(status=>{
    modelEnabled=status.modelEnabled===true;
    copilotConfigured=status.copilotConfigured===true;
    externalProvider=status.externalProvider||null;
    if (copilotConfigured) byId('assistantProvider').textContent='Microsoft Copilot configured · awaiting response';
    if (!copilotConfigured && (modelEnabled||externalProvider)) byId('assistantProvider').textContent='Report engine · '+(providerNames[externalProvider]||'Ollama')+' configured';
  }).catch(()=>{});
  fetch('/api/sources',{cache:'no-store'}).then(res=>res.ok?res.json():[]).then(result=>{
    sources=Array.isArray(result)?result:[];
    if(view==='Start') render();
  }).catch(()=>{});
}

}
if(typeof window!=='undefined') window.addEventListener('relatovue-account-change', refreshServerServices);
refreshServerServices();
