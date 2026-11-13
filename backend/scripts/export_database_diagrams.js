// Export schema metadata only; never include application records or secrets.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const db = require('../app/db/postgres');
async function main() {
    const columns=(await db.query(`SELECT c.table_name,c.column_name,c.is_nullable,format_type(a.atttypid,a.atttypmod) AS type
        FROM information_schema.columns c JOIN pg_class t ON t.relname=c.table_name AND t.relnamespace='public'::regnamespace AND t.relkind='r'
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
        WHERE c.table_schema='public' ORDER BY c.table_name,c.ordinal_position`)).rows;
    const constraints=(await db.query(`SELECT t.relname AS table_name,c.contype,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS cols,
        f.relname AS foreign_table,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS foreign_cols,
        c.confdeltype AS on_delete
        FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid LEFT JOIN pg_class f ON f.oid=c.confrelid
        WHERE t.relnamespace='public'::regnamespace AND c.contype IN ('p','u','f')`)).rows;
    const names=[...new Set(columns.map(c=>c.table_name))];
    const quote=s=>'"'+s.replaceAll('"','""')+'"';
    const type=s=>s.replace('timestamp with time zone','timestamptz').replace(/timestamp\((\d+)\) with time zone/,'timestamptz($1)').replace('double precision','float8');
    let dbml="Project Text2Speech {\n  database_type: 'PostgreSQL'\n}\n",mermaid='erDiagram\n    direction LR\n';
    for(const name of names) {
        const cons=constraints.filter(c=>c.table_name===name);
        dbml+='\nTable '+name+' {\n';mermaid+='\n    '+name+' {\n';
        for(const col of columns.filter(c=>c.table_name===name)) {
            const flags=[],keys=[];
            if(cons.some(c=>c.contype==='p'&&c.cols.includes(col.column_name))){flags.push('pk');keys.push('PK');}
            if(col.is_nullable==='NO')flags.push('not null');
            if(cons.some(c=>c.contype==='u'&&c.cols.length===1&&c.cols[0]===col.column_name)){flags.push('unique');keys.push('UK');}
            if(cons.some(c=>c.contype==='f'&&c.cols.includes(col.column_name)))keys.push('FK');
            dbml+='  '+quote(col.column_name)+' '+type(col.type)+(flags.length?' ['+flags.join(', ')+']':'')+'\n';
            mermaid+='        '+type(col.type)+' '+col.column_name+(keys.length?' '+keys.join(', '):'')+'\n';
        }
        const composites=cons.filter(c=>c.contype==='u'&&c.cols.length>1);
        if(composites.length)dbml+='\n  indexes {\n'+composites.map(c=>'    ('+c.cols.map(quote).join(', ')+') [unique]').join('\n')+'\n  }\n';
        dbml+='}\n';mermaid+='    }\n';
    }
    for(const con of constraints.filter(c=>c.contype==='f')) {
        // shortcut: current foreign keys use one column; extend both formats before adding composite FKs.
        assert.equal(con.cols.length,1,'Composite foreign key needs diagram support');
        assert.ok(columns.some(c=>c.table_name===con.foreign_table&&c.column_name===con.foreign_cols[0]),'Missing referenced column');
        const unique=constraints.some(c=>c.table_name===con.table_name&&['p','u'].includes(c.contype)&&JSON.stringify(c.cols)===JSON.stringify(con.cols));
        const parent=con.foreign_table+'.'+quote(con.foreign_cols[0]),child=con.table_name+'.'+quote(con.cols[0]);
        const action={r:'restrict',c:'cascade',a:'no action'}[con.on_delete]||'no action';
        dbml+='\nRef: '+(unique?parent+' - '+child:child+' > '+parent)+' [delete: '+action+']';
        const optional=columns.some(c=>c.table_name===con.table_name&&con.cols.includes(c.column_name)&&c.is_nullable==='YES');
        const requiredPart=['book_job_sources','book_job_drafts','book_job_runtime'].includes(con.table_name);
        mermaid+='\n    '+con.foreign_table+' '+(optional?'|o':'||')+'--'+(unique?(requiredPart?'||':'o|'):'o{')+' '+con.table_name+' : "'+con.cols.join('_')+'"';
    }
    const root=path.resolve(__dirname,'../..');
    assert.equal((dbml.match(/^Table /gm)||[]).length,names.length);
    assert.equal((dbml.match(/^Ref:/gm)||[]).length,constraints.filter(c=>c.contype==='f').length);
    fs.writeFileSync(path.join(root,'DATABASE.dbml'),dbml+'\n');
    fs.writeFileSync(path.join(root,'DATABASE.mmd'),mermaid+'\n');
    console.log('Generated diagrams:',names.length,'physical tables,',constraints.filter(c=>c.contype==='f').length,'foreign keys');
}
main().catch(error=>{console.error(error.code||error.name);process.exitCode=1;}).finally(()=>db.close());
