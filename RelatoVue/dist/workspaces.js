'use strict';
const workspaceMenu = (() => {
  function init({capture, activate, saved}) {
    const find=id=>document.getElementById(id);
    const dialog=find('workspaceDialog'), content=find('workspaceContent'), status=find('workspaceStatus');
    let account={user:null,workspaces:[]}, selected=null, busy=false;
    function updateLabel() {
      find('workspaceUser').textContent=account.user||'Guest';
      find('workspaceName').textContent=selected?.name||'Local workspace';
      find('workspaceAvatar').textContent=account.user?.slice(0,2).toUpperCase()||'RV';
    }
    async function request(operation,payload) {
      const response=await fetch('/api/workspaces'+(operation?'/'+operation:''),{
        cache:'no-store', ...(operation?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})}:{})
      });
      const data=await response.json();
      if(!response.ok) throw Error(data.error||'Workspace request failed.');
      return data;
    }
    function select(id) {
      selected=account.workspaces.find(item=>item.id===id)||account.workspaces[0]||null;
      activate(selected?.settings||{});
      updateLabel();
      window.dispatchEvent(new Event('relatovue-account-change'));
    }
    function bind(id,handler,event='click') {
      find(id)?.addEventListener(event,async e=>{
        e.preventDefault();
        if(busy) return;
        busy=true;
        status.textContent='';
        try { await handler(e); }
        catch(error) { status.textContent=error.message; }
        finally { busy=false; }
      });
    }
    function render() {
      updateLabel();
      if(location.protocol==='file:') {
        content.innerHTML='<p>Run <code>python server.py</code> to sign in and save workspaces.</p><a href="http://127.0.0.1:8765/">Open local RelatoVue</a>';
        return;
      }
      if(!account.user) {
        content.innerHTML='<p>Sign in or create a local account to save report settings. Database and AI services also require administrator approval.</p>'+
          '<form id="workspaceLogin"><label>Username<input id="workspaceUsername" minlength="3" maxlength="40" autocomplete="username" required></label>'+
          '<label>Password<input id="workspacePassword" type="password" minlength="12" maxlength="256" autocomplete="current-password" required></label>'+
          '<div class="wizard-actions"><button class="btn" type="submit" value="register">Create account</button>'+
          '<button class="btn primary" type="submit" value="login">Sign in</button></div></form>';
        bind('workspaceLogin',async e=>{
          const password=find('workspacePassword');
          const credentials={username:find('workspaceUsername').value,password:password.value};
          password.value='';
          account=await request(e.submitter?.value==='register'?'register':'login',credentials);
          select();
          render();
          status.textContent='Signed in.';
        },'submit');
        return;
      }
      content.innerHTML='<p>Switching workspaces clears the loaded dataset. Saved settings apply when you load a compatible dataset.</p>'+
        '<form id="workspaceSwitch"><label>Workspace<select id="workspaceSelect">'+
        options(account.workspaces.map(item=>[item.id,item.name]),selected?.id)+'</select></label>'+
        '<div class="wizard-actions"><button class="btn" type="submit">Switch workspace</button>'+
        '<button class="btn primary" id="workspaceSave" type="button">Save settings</button></div></form>'+
        '<form id="workspaceCreate"><label>New workspace name<input id="workspaceNewName" maxlength="60" required></label>'+
        '<div class="wizard-actions"><button class="btn" type="submit">Create workspace</button>'+
        '<button class="btn" id="workspaceLogout" type="button">Sign out</button></div></form>';
      bind('workspaceSwitch',()=>{
        const id=Number(find('workspaceSelect').value);
        if(id!==selected?.id) select(id);
        dialog.close();
      },'submit');
      bind('workspaceSave',async()=>{
        const id=selected?.id;
        account=await request('save',{id,settings:capture(selected?.settings||{})});
        selected=account.workspaces.find(item=>item.id===id);
        saved(selected.settings);
        render();
        status.textContent='Saved to '+selected.name+'.';
      });
      bind('workspaceCreate',async()=>{
        account=await request('create',{name:find('workspaceNewName').value});
        select(account.selected);
        render();
        status.textContent='Workspace created.';
      },'submit');
      bind('workspaceLogout',async()=>{
        account=await request('logout');
        select();
        render();
        status.textContent='Signed out.';
      });
    }
    find('workspaceMenu').addEventListener('click',()=>{
      status.textContent='';
      render();
      dialog.showModal();
    });
    dialog.addEventListener('close',()=>{content.replaceChildren();status.textContent='';});
    updateLabel();
    if(location.protocol!=='file:') {
      request().then(data=>{
        if(busy || !data.user) return;
        account=data;
        select();
        if(dialog.open) render();
      }).catch(()=>{});
    }
  }
  return {init};
})();
