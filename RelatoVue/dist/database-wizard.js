'use strict';
const databaseWizard = (() => {
  const engines = {
    postgres:{label:'PostgreSQL / AWS RDS',port:5432},
    mysql:{label:'MySQL / AWS RDS',port:3306},
    oracle:{label:'Oracle Database / Siebel',port:2484}
  };

  function open(onLoad) {
    const dialog = document.getElementById('databaseWizard');
    const body = document.getElementById('databaseWizardBody');
    const status = document.getElementById('databaseWizardStatus');
    const controller = new AbortController();
    const query = id => dialog.querySelector('#'+id);
    const field = (label,id,attrs='')=>'<label>'+label+'<input id="'+id+'" '+attrs+'></label>';
    const select = (label,id,choices,selected='')=>'<label>'+label+'<select id="'+id+'" required>'+
      '<option value="">Choose…</option>'+options(choices,selected)+'</select></label>';
    const message = (text='',error=false)=>{
      status.textContent=text;
      status.classList.toggle('error',error);
    };
    const form = (step,title,content,submit,back)=> {
      body.innerHTML='<div class="eyebrow">Step '+step+' of 3</div><h3>'+title+'</h3><form id="dbForm">'+content+
        '<div class="wizard-actions">'+(back?'<button type="button" class="btn" id="dbBack">Back</button>':'')+
        '<button class="btn primary" type="submit" id="dbNext">'+submit+'</button></div></form>';
      query('dbBack')?.addEventListener('click',back);
    };
    let connection, schemas=[], schema='', tables=[], table='', columns=[], busy=false;
    const request = async (operation,extra={},pending='Connecting…')=>{
      message(pending);
      const response=await fetch('/api/database/'+operation,{
        method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({connection,...extra})
      });
      const data=await response.json();
      if(!response.ok) throw Error(data.error || 'The database request failed.');
      return data;
    };
    function handleSubmit(run) {
      query('dbForm').addEventListener('submit',async event=>{
        event.preventDefault();
        if (busy) return;
        busy=true;
        const controls=[...event.currentTarget.querySelectorAll('input,select,button')].filter(control=>!control.disabled);
        controls.forEach(control=>{control.disabled=true;});
        try {
          await run();
        } catch(error) {
          if(!controller.signal.aborted) message(error.message || 'The database request failed.',true);
        } finally {
          busy=false;
          controls.forEach(control=>{control.disabled=false;});
        }
      });
    }
    function connectStep() {
      const previous=connection;
      connection=null;
      message();
      form(1,'Enter connection details',
        '<p>Use an account with read access to your reporting tables or views.</p><div class="wizard-fields">'+
        '<label>Database engine<select id="dbEngine">'+options(Object.entries(engines).map(([id,item])=>[id,item.label]),previous?.engine||'postgres')+'</select></label>'+
        field('Host','dbHost','required maxlength="255" placeholder="db.example.com" value="'+html(previous?.host)+'"')+
        field('Port','dbPort','type="number" required min="1" max="65535" value="'+html(previous?.port??5432)+'"')+
        '<label><span id="dbDatabaseLabel">Database name</span><input id="dbDatabase" required maxlength="128" value="'+html(previous?.database)+'"></label>'+
        field('Username','dbUser','required maxlength="128" autocomplete="off" value="'+html(previous?.user)+'"')+
        field('Password','dbPassword','type="password" maxlength="4096" autocomplete="off"')+
        '<label id="dbCaLabel">CA certificate path (optional)<input id="dbCa" maxlength="1024" placeholder="C:\certs\database-ca.pem" value="'+html(previous?.ca)+'"></label>'+
        '<label id="dbProtocolLabel" hidden>Oracle transport<select id="dbProtocol"><option value="tls">TLS (TCPS)</option><option value="tcp">TCP</option></select></label></div>'+
        '<p class="wizard-hint" id="dbTlsHint"></p>','Test connection',null);
      const engine=query('dbEngine'), protocol=query('dbProtocol');
      protocol.value=previous?.oracleTcp?'tcp':'tls';
      const updateTransport=reset=>{
        const isOracle=engine.value==='oracle';
        if (reset) query('dbPort').value=isOracle&&protocol.value==='tcp'?1521:engines[engine.value].port;
        query('dbDatabaseLabel').textContent=isOracle?'Service name':'Database name';
        query('dbCaLabel').hidden=isOracle;
        query('dbProtocolLabel').hidden=!isOracle;
        query('dbTlsHint').textContent=isOracle
          ? (protocol.value==='tcp'?'TCP does not request TLS. Use it only on a trusted network with your DBA’s approval.':'The server certificate and database hostname are verified.')
          : 'TLS verifies the database hostname and certificate. For RDS, enter the local path to your AWS CA bundle if needed.';
      };
      engine.addEventListener('change',()=>updateTransport(true));
      protocol.addEventListener('change',()=>updateTransport(true));
      updateTransport(false);
      handleSubmit(async()=>{
        connection={engine:engine.value,host:query('dbHost').value,port:Number(query('dbPort').value),
          database:query('dbDatabase').value,user:query('dbUser').value,password:query('dbPassword').value,
          ca:query('dbCa').value,oracleTcp:protocol.value==='tcp'};
        const result=await request('schemas',{},'Testing the connection and finding schemas…');
        if(controller.signal.aborted) return;
        query('dbPassword').value='';
        schemas=result.schemas;
        schema=schemas.includes(schema)?schema:schemas.includes('public')?'public':schemas[0]||'';
        table='';
        tables=[];
        relationStep();
        if(schema) await findTables();
      });
    }
    function relationStep() {
      form(2,'Choose a table or view',
        '<p>Choose a reporting view or table from the schemas your account can access.</p><div class="wizard-fields">'+
        select('Schema','dbSchema',schemas.map(name=>[name,name]),schema)+
        '<label>Table or view<select id="dbTable" required></select></label></div>','Choose columns',connectStep);
      const selector=query('dbSchema');
      selector.addEventListener('change',async()=>{
        schema=selector.value;
        table='';
        await findTables();
      });
      updateTables();
      if(!schemas.length) message('Connected. No accessible tables or views were found. Check your read permissions.');
      handleSubmit(async()=>{
        table=query('dbTable').value;
        const result=await request('columns',{schema,table},'Finding available columns…');
        if(controller.signal.aborted) return;
        columns=result.columns;
        if(!columns.length) throw Error('This table or view has no accessible columns.');
        columnStep();
      });
    }
    function updateTables() {
      query('dbTable').innerHTML='<option value="">Choose…</option>'+
        options(tables.map(({name,kind})=>[name,name+' · '+kind.toLowerCase()]),table);
      query('dbNext').disabled=!tables.length;
    }
    let tableRequest=0;
    async function findTables() {
      const id=++tableRequest;
      const selected=schema;
      tables=[];
      updateTables();
      if(!selected) { message('Choose a schema to browse its tables.'); return; }
      try {
        const result=await request('tables',{schema:selected},'Finding tables and views…');
        if(id!==tableRequest||controller.signal.aborted||!query('dbTable')) return;
        tables=result.tables;
        updateTables();
        message(tables.length?'Connection verified. Choose a table or view.':'No accessible tables or views were found in this schema.');
      } catch(error) {
        if(id===tableRequest&&!controller.signal.aborted&&query('dbTable')) message(error.message,true);
      }
    }
    function columnStep() {
      message();
      form(3,'Select columns and load',
        '<p>'+html(schema+'.'+table)+'</p><div class="wizard-column-actions">'+
        '<button class="btn" id="dbSelectAll" type="button">Select up to 256</button> '+
        '<button class="btn" id="dbClearAll" type="button">Clear selection</button></div>'+
        '<div class="wizard-columns" role="group" aria-label="Columns to load">'+columns.map(({name,type},index)=>
          '<label><input type="checkbox" name="dbColumns" value="'+index+'"'+(index<256?' checked':'')+'><span>'+
          html(name)+' <small>'+html(type)+'</small></span></label>').join('')+'</div>'+
        '<div class="wizard-fields">'+field('Row limit','dbLimit','type="number" required min="1" max="10000" value="1000"')+'</div>'+
        '<p class="wizard-hint">Rows are loaded in database return order. A limited result is a subset of the source.</p>',
        'Load report',()=>{message();relationStep();});
      const checkboxes=()=>[...dialog.querySelectorAll('[name="dbColumns"]')];
      query('dbSelectAll').addEventListener('click',()=>checkboxes().forEach((box,index)=>{box.checked=index<256;}));
      query('dbClearAll').addEventListener('click',()=>checkboxes().forEach(box=>{box.checked=false;}));
      handleSubmit(async()=>{
        const selected=checkboxes().filter(box=>box.checked).map(box=>columns[Number(box.value)].name);
        if(!selected.length||selected.length>256) throw Error('Select between 1 and 256 columns.');
        const dataset=await request('load',{schema,table,columns:selected,limit:Number(query('dbLimit').value)},'Loading the selected data…');
        if(controller.signal.aborted) return;
        dialog.close();
        onLoad(dataset);
      });
    }
    dialog.addEventListener('close',()=>{
      controller.abort();
      connection=null;
      body.innerHTML='';
      message();
    },{once:true});
    if(location.protocol==='file:') {
      body.innerHTML='<h3>Start the local reporting server</h3><p>In the RelatoVue project folder, run <code>python server.py</code>. Then open RelatoVue from the server to enter your database details.</p>'+
        '<div class="wizard-actions"><a class="btn primary" href="http://127.0.0.1:8765/">Open local RelatoVue</a></div>';
    } else connectStep();
    dialog.showModal();
  }

  return {open};
})();
