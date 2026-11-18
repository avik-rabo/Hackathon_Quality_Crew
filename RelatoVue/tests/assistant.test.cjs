'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const nodes=new Map();
function byId(id) {
  if(!nodes.has(id)) nodes.set(id,{
    value:'',textContent:'',innerHTML:'',messages:[],replaceChildren(){this.messages=[]},append(entry){this.messages.push(entry)},
    classList:{toggle(){}},addEventListener(event,fn){this[event]=fn},
    focus(){},scrollIntoView(){},insertAdjacentHTML(_,content){this.innerHTML+=content}
  });
  return nodes.get(id);
}
const ctx=vm.createContext({document:{getElementById:byId,createElement(){return {}}},location:{protocol:'file:'}});
for(const name of ['profile','report-assistant','app']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name+'.js'),'utf8'),ctx);
}
const evaluate=source=>vm.runInContext(source,ctx);
evaluate('applyData(demo)');
const cases=[];
for(const [phrase,chart] of [
  ['as a trend line','line'],['with columns','column'],['as a table','table'],['over time','line'],['monthly','line']
]) {
  for(const [label,measure] of [['Revenue',5],['records',-1]]) {
    for(const period of [1,2,3,6]) {
      cases.push({question:'Show '+label+' '+phrase+' for the last '+period+' months',action:'report',chart,measure,period});
    }
  }
}
for(const group of ['Region','Stage','Owner','Account']) {
  for(const [phrase,chart] of [['bar chart','bar'],['donut','donut'],['table','table'],['breakdown',undefined],['analysis',undefined]]) {
    cases.push({question:'Show Revenue by '+group+' as a '+phrase,action:'report',dimension:group,chart});
  }
}
for(const [question,dimension] of [
  ['Which quality rules failed?',undefined],['Show completeness','completeness'],['Review validity','validity'],
  ['Check accuracy','accuracy'],['Show timeliness','timeliness'],['Inspect consistency','consistency'],
  ['Show uniqueness','uniqueness'],['Find duplicates','uniqueness'],['Check missing fields','completeness'],
  ['Tell me about rule failures',undefined]
]) cases.push({question,action:'quality',dimension});
for(const question of ['Explain this report','Summarize the dataset','Give me an overview','Interpret this dashboard','Describe the loaded data']) {
  cases.push({question,action:'explain'});
}
for(const [left,right] of [
  ['Europe','North America'],['Asia Pacific','Latin America'],['Won','Lost'],['Pending','Won'],['Avery Kim','Sam Patel'],
  ['Jordan Reed','Morgan Ellis'],['Northstar Labs','Summit Digital'],['Europe','Asia Pacific'],['North America','Latin America'],['Lost','Pending']
]) cases.push({question:'Compare Revenue for '+left+' versus '+right,action:'compareGroups',groups:[left,right]});
for(const [month1,month2] of [[1,2],[2,3],[3,4],[4,5],[5,6],[1,6],[2,5],[1,3],[1,4],[2,6]]) {
  cases.push({question:'Compare Revenue by Region for 2026-0'+month1+' versus 2026-0'+month2,action:'comparePeriods',
    months:['2026-0'+month1,'2026-0'+month2]});
}
for(const question of ['Drop the table','Compare Mars versus Jupiter','What is tomorrow’s weather?',
  'Show Revenue last 999 months','Compare Revenue for 2026-01 versus 2027-01']) cases.push({question,action:null});
assert.equal(cases.length,100);
assert.equal(new Set(cases.map(item=>item.question)).size,100);
for(const item of cases) {
  ctx.testQuestion=item.question;
  const result=evaluate(`{
    const context=assistantContext();
    const plan=reportAssistant.validate(reportAssistant.plan(testQuestion,context),context);
    plan && reportAssistant.execute(plan,context,dataset.rows,dataset.columns,{measure,dimension,dateField,numeric,month:dateMonth});
  }`);
  assert.equal(result?.action??null,item.action,item.question);
  for(const key of ['chart','measure','period','groups','months']) {
    if(item[key]!==undefined) assert.deepEqual(JSON.parse(JSON.stringify(result[key])),item[key],item.question);
  }
  if(item.action==='quality') assert.equal(result.dimensionName,item.dimension,item.question);
  if(item.action==='report'&&item.dimension) assert.equal(evaluate('dataset.columns')[result.dimension],item.dimension);
  if(item.period) assert.equal(result.count,Math.min(6,item.period)*36);
  if(item.action==='comparePeriods') assert.ok(result.entries.every(([,sum])=>sum>0));
}
(async()=>{
  byId('assistantQuestion').value='Compare Revenue for Europe versus North America';
  await byId('assistantForm').submit({preventDefault(){}});
  assert.match(byId('assistantHistory').messages.at(-1).textContent,/Europe.*North America.*Difference/);
  assert.equal(evaluate('new Set(scopedRows().map(row=>row[2])).size'),2);
  assert.match(byId('dashboardPerformance').innerHTML,/Revenue by Region/);
  byId('assistantQuestion').value='Drop the table';
  await byId('assistantForm').submit({preventDefault(){}});
  assert.equal(evaluate('new Set(scopedRows().map(row=>row[2])).size'),2);
  byId('assistantClear').click();
  assert.equal(evaluate('scopedRows().length'),216);
  byId('assistantQuestion').value='Which quality rules failed?';
  await byId('assistantForm').submit({preventDefault(){}});
  assert.equal(evaluate('view'),'Dashboard');
  assert.match(byId('assistantHistory').messages.at(-1).textContent,/rules with failures/);
  const year=new Date().getFullYear();
  evaluate("applyData({...demo,rows:demo.rows.map(row=>row.map((value,index)=>index===4?String(new Date().getFullYear())+value.slice(4):value))})");
  for(const question of [
    'which account won the maximum revenue for closed quarter ending april this year?',
    'Who was the top account by Revenue in the quarter ended in April this year?',
    'Which account had the highest revenue for the quarter ending Apr '+year+'?',
    'Which account had the lowest revenue in the quarter ending May this year?'
  ]) {
    byId('assistantQuestion').value=question;
    await byId('assistantForm').submit({preventDefault(){}});
    const reply=byId('assistantHistory').messages.at(-1).textContent;
    assert.match(reply,/had the (highest|lowest) Revenue|tied for (highest|lowest) Revenue/);
    assert.match(byId('dashboardPerformance').innerHTML,/Revenue by Account/);
    assert.equal(evaluate('new Set(scopedRows().map(row=>dateMonth(row[4]))).size'),3);
    if(question.includes('won')) assert.equal(evaluate("scopedRows().every(row=>row[3]==='Won')"),true);
  }
  assert.equal(byId('assistantHistory').messages.length,8);
  byId('assistantQuestion').value='Which account earned the most revenue in the quarter ending January this year?';
  await byId('assistantForm').submit({preventDefault(){}});
  assert.match(byId('assistantHistory').messages.at(-1).textContent,/couldn’t match/);
  evaluate('copilotConfigured=true');
  ctx.fetch=async (url, options)=>{
    assert.equal(url,'/api/assistant/plan');
    const payload=JSON.parse(options.body);
    assert.equal(payload.rows,undefined);
    assert.equal(payload.groups,undefined);
    return {ok:true,json:async()=>({action:'report',measure:'Revenue',dimension:'Region',chart:'bar'})};
  };
  byId('assistantQuestion').value='Give me the regional picture';
  await byId('assistantForm').submit({preventDefault(){}});
  assert.match(byId('assistantHistory').messages.at(-1).textContent,/Microsoft Copilot \+ report engine/);
  assert.match(byId('dashboardPerformance').innerHTML,/Revenue by Region/);
  assert.equal(byId('assistantProvider').textContent,'Powered by Microsoft Copilot');
  evaluate("dataset=null;view='Start';render()");
  const send=async question=>{
    byId('assistantQuestion').value=question;
    await byId('assistantForm').submit({preventDefault(){}});
    return byId('assistantHistory').messages.at(-1).textContent;
  };
  for(const provider of ['Copilot Studio','Gemini','Claude','Grok','OpenAI','Ollama','LM Studio']) {
    assert.match(await send('connect to '+provider),/Step 1 of/);
    assert.match(await send('next'),/Step 2 of/);
    assert.match(await send('back'),/Step 1 of/);
    assert.match(await send('repeat'),/Step 1 of/);
    assert.match(await send('cancel'),/guide closed/);
  }
  assert.match(await send('connect to unknown runtime'),/local OpenAI-compatible/);
  assert.match(await send('check Claude'),/python server.py/);
  evaluate("location.protocol='http:'");
  ctx.fetch=async url=>url.endsWith('/status')?{ok:true,json:async()=>({externalProvider:'claude'})}:
    {ok:true,json:async()=>({action:'explain'})};
  assert.match(await send('check Claude'),/Claude returned the expected test response/);
  assert.match(await send('check Gemini'),/Gemini is not configured/);
  ctx.fetch=async url=>url.endsWith('/status')?{ok:true,json:async()=>({externalProvider:'claude'})}:
    {ok:false,json:async()=>({error:'claude API returned HTTP 401. Check the API key.'})};
  assert.match(await send('check Claude'),/HTTP 401/);
  evaluate("navigate('Start')");
  assert.match(byId('app').innerHTML,/Open a data source/);
  assert.doesNotMatch(byId('app').innerHTML,/Apply goals|name="intent"/);
  byId('sampleSales').click();
  assert.equal(evaluate('view'),'Dashboard');
  assert.match(byId('app').innerHTML,/Dataset overview/);
  assert.match(byId('dashboardPerformance').innerHTML,/Performance/);
  assert.match(byId('dashboardPerformance').innerHTML,/Revenue by Region/);
  assert.match(byId('dashboardProfile').innerHTML,/Field profile/);
  assert.match(byId('nav').innerHTML,/Explore records/);
  byId('heroExplore').click();
  assert.equal(evaluate('view'),'Explore records');
  assert.match(byId('app').innerHTML,/Search records/);

  evaluate("navigate('Start')");
  ctx.databaseWizard={open(onLoad){return onLoad({name:'public.sales',source:'PostgreSQL',columns:['Region','Revenue'],rows:[['West',10],['East',20]]})}};
  await byId('databaseSetup').click();
  assert.equal(evaluate('view'),'Dashboard');
  assert.match(byId('dashboardPerformance').innerHTML,/Revenue by Region/);

  evaluate("activateWorkspace({goals:['comparison'],measure:'Revenue',dimension:'Stage',groupChart:'donut',profileKey:'Deal'})");
  assert.equal(evaluate('dataset'),null);
  assert.equal(evaluate('view'),'Start');
  assert.equal(evaluate('referenceFile'),null);
  byId('sampleSales').click();
  assert.equal(evaluate('dataset.columns[dimension]'),'Stage');
  assert.equal(evaluate('groupChart'),'donut');
  assert.equal(evaluate('profileSettings.key'),0);
  const saved=evaluate('captureWorkspace({})');
  assert.equal(saved.dimension,'Stage');
  assert.equal(saved.rows,undefined);
  assert.equal(saved.reference,undefined);

  await evaluate(`loadSource('outcomes.csv',async()=>({name:'outcomes.csv',source:'CSV file',
    columns:['full_date','rule_name','population_name','population_party_type','population','invalids','valids','score'],
    rows:[
      ['18-11-2026','CMPL_BSNNumber','Default','ALL','488167','64917','423250','86.7'],
      ['18-11-2026','CMPL_BSNNumber','Deceased','NP','60196','235','59961','99.61'],
      ['18-11-2026','VALD_Initials','Minors','NP','75262','1058','74204','98.59'],
      ['19-11-2026','VALD_Initials','Minors','OTHER','75262','12','75250','100%'],
      ['19-11-2026','Invalid','Default','ALL','1','5','0','1']
    ]
  }))`);
  assert.equal(evaluate('reportMode()'),'outcomes');
  assert.equal(evaluate('view'),'Dashboard');
  assert.doesNotMatch(byId('dashboardOutcomes').innerHTML,/Outcome column mapping/);
  assert.match(byId('outcomeCharts').innerHTML,/Failed rules by population.*Reported score distribution/);
  byId('outcome-breakdown').change({target:{value:'rule'}});
  assert.match(byId('outcomeCharts').innerHTML,/Largest invalid counts by rule.*64,917/);
  assert.match(byId('dashboardOutcomes').innerHTML,/1 source row excluded/);
  assert.match(byId('outcomeStats').innerHTML,/<strong>2<\/strong><span>Failed rules/);
  assert.match(byId('outcomeResults').innerHTML,/CMPL_BSNNumber.*18-11-2026.*Default.*64,917.*86\.7/);
  assert.doesNotMatch(byId('outcomeResults').innerHTML,/488,167.*488,167/);
  assert.match(evaluate('applyAssistantResult({action:"explain"})'),/largest invalid count in one outcome \(64,917\)/);
  byId('outcome-partyFilter').change({target:{value:'NP'}});
  byId('outcome-minScore').change({target:{value:'99'}});
  assert.match(byId('outcomeResults').innerHTML,/Deceased/);
  assert.match(byId('outcomeCharts').innerHTML,/1 outcome · 99\.61/);
  assert.doesNotMatch(byId('outcomeResults').innerHTML,/Default|Minors/);
  byId('exploreOutcomes').click();
  assert.equal(evaluate('view'),'Explore records');
  assert.equal(evaluate('matchingRows().length'),1);
  assert.equal(evaluate('captureWorkspace({}).outcomeFields.date'),'full_date');
  assert.equal(evaluate('captureWorkspace({}).outcomeFields.party'),'population_party_type');
  assert.equal(evaluate("dataProfile.outcomeDate('31-11-2026')"),'');
  assert.equal(evaluate("dataProfile.outcomeDate('2026-11-19T00:00:00Z')"),'2026-11-19');

  evaluate("navigate('Dashboard')");
  byId('datasetMode').change({target:{value:'outcomes'}});
  assert.match(byId('dashboardOutcomes').innerHTML,/Outcome column mapping/);
  byId('datasetMode').change({target:{value:'auto'}});
  assert.doesNotMatch(byId('dashboardOutcomes').innerHTML,/Outcome column mapping/);

  evaluate("applyData({name:'unknown',columns:['A','B','C','D'],rows:[['Email','10','8','2']]})");
  byId('datasetMode').change({target:{value:'outcomes'}});
  assert.match(byId('dashboardOutcomes').innerHTML,/Map the rule/);
  assert.doesNotMatch(byId('app').innerHTML,/#outcomeFilters/);
  for (const [index,key] of ['rule','population','valid','invalid'].entries()) byId('outcome-'+key).value=String(index);
  for (const key of ['ruleKey','group','party','date','score']) byId('outcome-'+key).value='-1';
  byId('outcome-invalid').value='2';
  byId('outcomeMapping').submit({preventDefault(){}});
  assert.match(byId('outcomeStatus').textContent,/different column/);
  byId('outcome-invalid').value='3';
  byId('outcomeMapping').submit({preventDefault(){}});
  assert.match(byId('outcomeResults').innerHTML,/Email.*80%/);
  assert.match(byId('outcomeCharts').innerHTML,/Pass-rate distribution.*1 outcome · 80%/);

  evaluate("applyData({name:'legacy',columns:['dimension','rule','passed','failed','not_assessed'],rows:[['Accuracy','Email','10','2','1']]})");
  assert.equal(evaluate('reportMode()'),'outcomes');
  assert.match(byId('outcomeResults').innerHTML,/Derived population.*Email.*<td>13<\/td>/);
  evaluate("applyData({name:'legacy',columns:['dimension','rule','status'],rows:[['Accuracy','Email','failed']]})");
  assert.equal(evaluate('reportMode()'),'reported');
  assert.match(byId('dashboardProfile').innerHTML,/Reported checks/);
  assert.doesNotMatch(byId('dashboardProfile').innerHTML,/Field profile/);

  const summary=evaluate(`{
    const columns=['rule_name','rule_key','population','score','valid','invalid','filter_group'];
    const rows=[
      ['VALD_Deceased_dt','1','50000','67','33500','16500','Retail'],
      ['Renamed rule','1','50000','66','33000','17000','Retail'],
      ['VALD_Deceased_dt','1','50000','98','49000','1000','Business'],
      ['VALD_Customer_id','2','50000','100','50000','0','Retail'],
      ['VALD_Customer_id','3','50000','99','49500','500','Retail'],
      ['Unlabeled rule','4','50000','99','49500','500','']
    ];
    const mapping=dataProfile.mapOutcomeFields(columns);
    const {results}=dataProfile.readOutcomes(rows,mapping);
    const {rules,failed,populations}=dataProfile.summarizeOutcomes(results);
    ({rules,failed,populations:populations.map(({label,population,rules,failed})=>[label,population,rules,failed])});
  }`);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)),{
    rules:4,failed:3,populations:[['Retail',null,3,2],['Business',null,1,1],['',50000,1,1]]
  });
  console.log('Passed 100 distinct analytical questions and report integration checks.');
})().catch(error=>{console.error(error);process.exitCode=1});
