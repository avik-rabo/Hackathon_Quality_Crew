'use strict';
const reportAssistant = (() => {
  const normalize = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const contains = (text,value) => (' '+text+' ').includes(' '+value+' ');
  const has = (text,pattern) => pattern.test(text);
  const dimensions = ['completeness','validity','accuracy','timeliness','consistency','uniqueness'];
  function plan(question, context) {
    const q=normalize(question);
    if (!q || /\b(delete|drop|truncate|password|credentials|insert|execute sql|update the database|send|upload|export all)\b/.test(q)) return null;
    if (/\b(data quality|quality|rule failures|failed rules|duplicates|duplicate|missing fields|missing values)\b/.test(q) ||
        dimensions.some(name=>contains(q,name))) {
      const dimension=dimensions.find(name=>contains(q,name)) || (/\bduplicates?\b/.test(q)?'uniqueness':/\bmissing (fields|values)\b/.test(q)?'completeness':undefined);
      return {action:'quality',dimension};
    }
    if (/\b(explain|summarize|summary|describe|interpret|overview)\b/.test(q) &&
        !/\b(by|compare|trend|donut|bar|column)\b/.test(q)) return {action:'explain'};
    const measures=context.measures.filter(name=>contains(q,normalize(name))).sort((a,b)=>b.length-a.length);
    const fields=context.dimensions.filter(name=>contains(q,normalize(name))).sort((a,b)=>b.length-a.length);
    const measure=/\b(records?|row count|count of rows|volume)\b/.test(q)?'count':measures[0];
    const dimension=fields.find(name=>name!==measure);
    const ranking=/\b(maximum|highest|most|top|largest|best|lowest|least|smallest)\b/.test(q);
    if (ranking && measure && dimension) {
      const quarter=q.match(/\bquarter (?:ending|ended|through|to) (?:in )?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/);
      const year=Number(q.match(/\b(?:19|20)\d{2}\b/)?.[0] || context.year || new Date().getFullYear());
      let months;
      if (quarter) {
        const end=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(quarter[1].slice(0,3));
        months=[2,1,0].map(offset=>new Date(Date.UTC(year,end-offset,1)).toISOString().slice(0,7));
      } else if (/\b(quarter|year|month|yesterday|today)\b/.test(q)) return null;
      const won=/\b(won|winning)\b/.test(q);
      const status=won?Object.keys(context.groups).find(field=>/^(stage|status|outcome)$/.test(normalize(field))&&context.groups[field].some(value=>/^(closed )?won$/.test(normalize(value)))):undefined;
      if (won && !status) return null;
      return {action:'rank',measure,dimension,months,status,lowest:/\b(lowest|least|smallest)\b/.test(q)};
    }
    const chart=/\bdonut\b/.test(q)?'donut':/\b(bar|bars)\b/.test(q)?'bar':/\b(columns?|column chart)\b/.test(q)?'column':
      /\b(line|trend|over time|monthly)\b/.test(q)?'line':/\b(table|tabular)\b/.test(q)?'table':undefined;
    const period=question.match(/\b(?:last|past|latest)\s+(\d+)\s+months?\b/i)?.[1];
    const months=[...new Set(question.match(/\b\d{4}-(?:0[1-9]|1[0-2])\b/g)||[])];
    const compare=/\b(compare|versus|vs|difference|declin\w*|contribut\w*)\b/.test(q);
    const groups=Object.entries(context.groups).map(([field,values])=>[field,values.filter(value=>normalize(value)&&contains(q,normalize(value)))])
      .filter(([,values])=>values.length>=2);
    if (compare && groups.length===1 && groups[0][1].length===2 && !months.length) {
      return {action:'compareGroups',measure,dimension:groups[0][0],groups:groups[0][1].slice().sort((a,b)=>q.indexOf(normalize(a))-q.indexOf(normalize(b)))};
    }
    if (compare && (months.length || /\b(months?|periods?|over time|declin\w*)\b/.test(q))) {
      if (months.length!==0 && months.length!==2) return null;
      return {action:'comparePeriods',measure,dimension,months};
    }
    if (compare || ranking || /\b(quarter|yesterday|today|this year|last year)\b/.test(q)) return null;
    if (chart || dimension || period || (measure && /\b(show|total|sum|how many|count|what)\b/.test(q))) return {action:'report',measure,dimension,chart,period:period?Number(period):undefined};
    return null;
  }

  function validate(plan, context) {
    if (!plan || !['explain','report','quality','compareGroups','comparePeriods','rank'].includes(plan.action)) return null;
    const {action,measure,dimension,chart,period,months,groups}=plan;
    if (measure!==undefined && measure!=='count' && !context.measures.includes(measure)) return null;
    if (action!=='quality' && dimension!==undefined && !context.dimensions.includes(dimension)) return null;
    if (action==='quality' && dimension!==undefined && !dimensions.includes(dimension)) return null;
    if (chart!==undefined && !['line','column','bar','donut','table'].includes(chart)) return null;
    if (period!==undefined && (!Number.isInteger(period)||period<1||period>120)) return null;
    if (action==='compareGroups' && (!dimension || !Array.isArray(groups) || groups.length!==2 ||
        groups[0]===groups[1] || !groups.every(value=>context.groups[dimension]?.includes(value)))) return null;
    if (action==='comparePeriods' && (!Array.isArray(months) || ![0,2].includes(months.length) ||
        (months.length===2 && months[0]===months[1]) || !months.every(value=>context.months.includes(value)))) return null;
    if (action==='rank' && (!dimension || !measure ||
        (months!==undefined && (!Array.isArray(months)||months.length!==3||!months.every(month=>context.months.includes(month)))) ||
        (plan.status!==undefined && !context.groups[plan.status]?.some(value=>/^(closed )?won$/.test(normalize(value)))))) return null;
    return {action,measure,dimension,chart,period,months,groups,status:plan.status,lowest:plan.lowest===true};
  }

  function execute(plan, context, rows, columns, current) {
    const next={measure:plan.measure==='count'?-1:plan.measure===undefined?current.measure:columns.indexOf(plan.measure),
      dimension:plan.dimension===undefined?current.dimension:columns.indexOf(plan.dimension)};
    if (plan.action==='quality' || plan.action==='explain') return {...next,action:plan.action,dimensionName:plan.dimension};
    const value=row=>next.measure<0?1:current.numeric(row[next.measure])?Number(row[next.measure]):0;
    const sum=items=>items.reduce((total,row)=>total+value(row),0);
    const label=next.measure<0?'Records':columns[next.measure];
    const result={...next,action:plan.action,chart:plan.chart,period:plan.period,label};
    if (plan.action==='rank') {
      const status=columns.indexOf(plan.status);
      const match=row=>(!plan.months||plan.months.includes(current.month(row[current.dateField]))) &&
        (status<0||/^(closed )?won$/.test(normalize(row[status]))) && String(row[next.dimension]??'').trim()!=='' &&
        (next.measure<0||current.numeric(row[next.measure]));
      const totals=new Map();
      for(const row of rows.filter(match)) {
        const key=String(row[next.dimension]);
        totals.set(key,(totals.get(key)??0)+value(row));
      }
      const order=plan.lowest?1:-1;
      const ranked=[...totals].sort((a,b)=>order*(a[1]-b[1]));
      if (!ranked.length) return null;
      return {...result,match,months:plan.months,status:plan.status,lowest:plan.lowest,
        leaders:ranked.filter(item=>item[1]===ranked[0][1])};
    }
    if (plan.action==='compareGroups') {
      result.groups=plan.groups;
      result.entries=plan.groups.map(group=>[group,sum(rows.filter(row=>String(row[next.dimension])===group))]);
    } else if (plan.action==='comparePeriods') {
      const selected=(plan.months.length?plan.months:context.months.slice(-2)).slice().sort();
      if (selected.length!==2) return null;
      const monthRows=selected.map(month=>rows.filter(row=>current.month(row[current.dateField])===month));
      result.months=selected;
      result.entries=selected.map((month,index)=>[month,sum(monthRows[index])]);
      if(next.dimension>=0) {
        const totals=new Map();
        monthRows.forEach((items,index)=>items.forEach(row=>{
          const key=String(row[next.dimension]??'(Missing)');
          totals.set(key,(totals.get(key)||0)+(index===0?-1:1)*value(row));
        }));
        result.contributor=[...totals].sort((a,b)=>result.entries[1][1]<result.entries[0][1]?a[1]-b[1]:b[1]-a[1])[0];
      }
    } else {
      if (['line','column'].includes(plan.chart) && !context.months.length) return null;
      if (['bar','donut'].includes(plan.chart) && next.dimension<0) return null;
      const selected=plan.period?new Set(context.months.slice(-plan.period)):null;
      if (selected && !selected.size) return null;
      const scoped=selected?rows.filter(row=>selected.has(current.month(row[current.dateField]))):rows;
      result.total=sum(scoped);
      result.count=scoped.length;
    }
    return result;
  }
  return {plan,validate,execute};
})();
