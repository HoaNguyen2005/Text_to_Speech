// Offline regression: Keycloak replaces omitted profile fields during PUT.
const assert = require('node:assert/strict');
const copy = value => structuredClone(value);
const original = { id:'identity', username:'profile-test', email:'profile@example.invalid', emailVerified:true, enabled:true,
    firstName:'Người kiểm thử', attributes:{mongoUserId:['a'.repeat(24)],gender:['male'],legacyStatus:['active']} };
let identity = copy(original), corruptEmail = false, writes = 0;
let stored = {_id:'a'.repeat(24),keycloakId:'identity',email:original.email,fullName:original.firstName,gender:'male',status:'active',profile_version:0,authSyncVersion:0};
const model = value => ({...copy(value),toObject:()=>copy(value)});
const problem = (status,message,code) => Object.assign(new Error(message),{status,code});
const mock = (path,exports) => { require.cache[require.resolve(path)] = {id:require.resolve(path),filename:require.resolve(path),loaded:true,exports}; };
mock('../app/db/postgres',{transaction:work=>work({query:async()=>({rows:[]})})});
mock('../app/models/user.model',{
    findById:async()=>model(stored),
    findOneAndUpdate:async(filter,update)=>{
        assert.equal(filter.profile_version,stored.profile_version);
        Object.assign(stored,update.$set);
        for(const [key,value] of Object.entries(update.$inc)) stored[key]+=value;
        writes++;
        return model(stored);
    }
});
mock('../app/services/keycloak.service',{problem,keycloakService:()=>({request:async(endpoint,options={})=>{
    assert.equal(endpoint,'/users/identity');
    if(options.method==='PUT') {
        identity={...identity,...copy(options.body),email:options.body.email};
        if(corruptEmail) delete identity.email;
        return null;
    }
    return copy(identity);
}})});
const {update}=require('../app/services/profile.service');
async function main(){
    for(const gender of ['female','male','other']){
        const saved=await update({...stored,role:'user'},{fullName:'Tên đã sửa',gender,profile_version:stored.profile_version});
        assert.equal(saved.gender,gender);
        assert.equal(identity.email,original.email);
        assert.equal(identity.emailVerified,true);
        assert.equal(identity.username,original.username);
        assert.equal(identity.enabled,true);
        assert.deepEqual(identity.attributes.mongoUserId,original.attributes.mongoUserId);
        assert.deepEqual(identity.attributes.legacyStatus,original.attributes.legacyStatus);
    }
    assert.equal(stored.profile_version,3);
    await assert.rejects(update(stored,{fullName:'Tên',gender:'male',profile_version:0}),{code:'PROFILE_CONFLICT'});
    await assert.rejects(update(stored,{fullName:'Tên',gender:'male',profile_version:3,email:'attacker@example.invalid'}),{code:'INVALID_PROFILE'});
    corruptEmail=true;
    await assert.rejects(update(stored,{fullName:'Tên',gender:'male',profile_version:3}),{code:'PROFILE_SYNC_FAILED'});
    assert.equal(writes,3,'Never save locally after identity verification fails');
    corruptEmail=false;
    await assert.rejects(update(stored,{fullName:'Tên',gender:'male',profile_version:3}),{code:'PROFILE_REQUIRED'});

    let profile={attributes:[{name:'username'},{name:'email',required:{roles:['user']}},{name:'firstName'},{name:'lastName',required:{roles:['user']}}]};
    mock('./lib/keycloak-local',{loadLocalConfig:()=>({}),createAdminClient:()=>({realm:'test',request:async(endpoint,options={})=>{
        assert.equal(endpoint,'/users/profile');
        if(options.method==='PUT') profile=JSON.parse(options.body);
        return {body:copy(profile)};
    }})});
    await require('./configure_keycloak_local').configure();
    assert.ok(!profile.attributes.some(entry=>entry.name==='lastName'));
    assert.equal(profile.attributes.find(entry=>entry.name==='firstName').displayName,'Họ tên');
    assert.deepEqual(profile.attributes.find(entry=>entry.name==='email').required,{roles:['user']});
    console.log('PASS: repeated profile saves preserve email/identity, reject stale or unsafe input, verify sync and remove Last name');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
