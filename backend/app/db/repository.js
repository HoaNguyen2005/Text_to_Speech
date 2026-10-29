// Small SQL repository for the application's existing query interface.
// Data is stored in typed relational columns, with JSONB only for nested book state.
const crypto = require('crypto');
const db = require('./postgres');
const tables = require('./tables');
const quote = (name) => `"${name}"`;
const newId = () => crypto.randomBytes(12).toString('hex');

function repository(table) {
    const spec = tables[table];
    if (!spec) throw new Error('Unknown SQL table');
    const columns = new Set(spec.columns);
    const json = new Set(spec.json || []);
    const hidden = new Set(spec.hidden || []);
    function field(name, params) {
        const [root, ...parts] = name.split('.');
        if (!columns.has(root)) throw new Error(`Unknown field in ${table}`);
        if (!parts.length) return quote(root);
        if (!json.has(root) || parts.some((part) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part))) throw new Error('Invalid nested field');
        params.push(parts);
        return `(${quote(root)} #>> $${params.length}::text[])`;
    }
    function where(filter, params) {
        const conditions = [];
        for (const [key, value] of Object.entries(filter || {})) {
            if (key === '$or' || key === '$and') {
                if (!Array.isArray(value) || !value.length) throw new Error('Empty SQL predicate group');
                conditions.push(`(${value.map((item) => where(item, params)).join(key === '$or' ? ' OR ' : ' AND ')})`);
                continue;
            }
            const expression = field(key, params);
            const operations = value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) ? value : { $eq: value };
            for (const [operator, operand] of Object.entries(operations)) {
                if (operator === '$exists') { conditions.push(`${expression} IS ${operand ? 'NOT ' : ''}NULL`); continue; }
                if (operator === '$in') {
                    if (!Array.isArray(operand)) throw new Error('Invalid SQL IN');
                    const entries = operand.map((item) => { params.push(item); return `$${params.length}`; });
                    conditions.push(entries.length ? `${expression} IN (${entries.join(',')})` : 'FALSE');
                    continue;
                }
                if (operand === null || operand === undefined) {
                    if (!['$eq','$ne'].includes(operator)) throw new Error('Invalid null comparison');
                    conditions.push(`${expression} IS ${operator === '$ne' ? 'NOT ' : ''}NULL`); continue;
                }
                const symbols = { $eq: '=', $ne: 'IS DISTINCT FROM', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' };
                if (!symbols[operator]) throw new Error('Unsupported SQL comparison');
                params.push(key.includes('.') && typeof operand !== 'string' ? String(operand) : operand);
                conditions.push(`${expression} ${symbols[operator]} $${params.length}`);
            }
        }
        return conditions.length ? conditions.join(' AND ') : 'TRUE';
    }
    function order(sort = {}) {
        return Object.entries(sort).map(([key, direction]) => {
            if (!columns.has(key) || ![1,-1].includes(direction)) throw new Error('Invalid SQL sort');
            return `${quote(key)} ${direction === -1 ? 'DESC' : 'ASC'} NULLS LAST`;
        }).join(',');
    }
    function projection(selection) {
        const tokens = (selection || '').split(/\s+/).filter(Boolean);
        const included = tokens.filter((key) => !key.startsWith('-') && !key.startsWith('+'));
        const names = included.length ? new Set(['_id', ...included]) : new Set(spec.columns.filter((key) => !hidden.has(key)));
        for (const token of tokens) {
            if (token.startsWith('-')) names.delete(token.slice(1));
            if (token.startsWith('+')) names.add(token.slice(1));
        }
        return [...names].filter((key) => columns.has(key));
    }
    function hydrate(row, selection, plain = false) {
        if (!row) return null;
        const result = {};
        for (const key of projection(selection)) if (row[key] !== null && row[key] !== undefined) result[key] = row[key];
        return plain ? result : new Model(result, true);
    }
    function parameter(key, value) { return value == null ? null : json.has(key) ? JSON.stringify(value) : value; }
    async function insert(data) {
        const values = { ...structuredClone(spec.defaults || {}), ...data, _id: data._id || newId() };
        if (table === 'users' && typeof values.email === 'string') values.email = values.email.trim().toLowerCase();
        if (table === 'users' && typeof values.fullName === 'string') values.fullName = values.fullName.trim();
        if (spec.timestamps) { values.createdAt ||= new Date(); values.updatedAt ||= values.createdAt; }
        const fields = spec.columns.filter((key) => values[key] !== undefined);
        const sql = `INSERT INTO ${quote(table)} (${fields.map(quote).join(',')}) VALUES (${fields.map((key, i) => `$${i + 1}${json.has(key) ? '::jsonb' : ''}`).join(',')}) RETURNING *`;
        return (await db.query(sql, fields.map((key) => parameter(key, values[key])))).rows[0];
    }
    function changes(update, params) {
        const expressions = new Map();
        const assign = (key, value, remove = false, increment = false) => {
            const [root, ...parts] = key.split('.');
            if (!columns.has(root) || root === '_id') throw new Error('Invalid SQL update column');
            if (parts.length) {
                if (!json.has(root) || parts.some((part) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part))) throw new Error('Invalid JSONB update');
                params.push(parts); const keyParam = `$${params.length}::text[]`;
                const current = expressions.get(root) || `COALESCE(${quote(root)}, '{}'::jsonb)`;
                if (remove) expressions.set(root, `(${current} #- ${keyParam})`);
                else { params.push(JSON.stringify(value)); expressions.set(root, `jsonb_set(${current}, ${keyParam}, $${params.length}::jsonb, true)`); }
            } else if (remove) expressions.set(root, 'NULL');
            else {
                params.push(parameter(root, value));
                expressions.set(root, increment ? `COALESCE(${quote(root)},0) + $${params.length}` : `$${params.length}${json.has(root) ? '::jsonb' : ''}`);
            }
        };
        const hasOperators = Object.keys(update).some((key) => key.startsWith('$'));
        for (const [key, value] of Object.entries(hasOperators ? update.$set || {} : update)) assign(key, value);
        for (const key of Object.keys(update.$unset || {})) assign(key, null, true);
        for (const [key, value] of Object.entries(update.$inc || {})) assign(key, value, false, true);
        for (const key of Object.keys(update)) if (key.startsWith('$') && !['$set','$unset','$inc','$setOnInsert'].includes(key)) throw new Error('Unsupported SQL update');
        if (spec.timestamps && expressions.size) expressions.set('updatedAt', 'now()');
        return [...expressions].map(([key, value]) => `${quote(key)}=${value}`).join(',');
    }
    async function updateOne(filter, update, options = {}) {
        return db.transaction(async () => {
            if (options.upsert) {
                const identity = Object.fromEntries(Object.entries(filter).filter(([key, value]) => columns.has(key) && (value === null || typeof value !== 'object' || value instanceof Date)));
                await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [table + ':' + JSON.stringify(identity, Object.keys(identity).sort())]);
            }
            const params = [];
            const predicate = where(filter, params);
            const sorting = order(options.sort);
            // A claimed job is locked until its update commits; other workers skip this row.
            const skip = table === 'book_jobs' && options.sort ? ' SKIP LOCKED' : '';
            const existing = (await db.query(`SELECT * FROM ${quote(table)} WHERE ${predicate}${sorting ? ' ORDER BY ' + sorting : ''} LIMIT 1 FOR UPDATE${skip}`, params)).rows[0];
            if (!existing) {
                if (!options.upsert) return { row: null, matchedCount: 0, modifiedCount: 0 };
                const data = Object.fromEntries(Object.entries(filter).filter(([key, value]) => columns.has(key) && (value === null || typeof value !== 'object' || value instanceof Date)));
                Object.assign(data, update.$setOnInsert || {}, update.$set || {});
                if (!Object.keys(update).some((key) => key.startsWith('$'))) Object.assign(data, update);
                for (const [key, value] of Object.entries(update.$inc || {})) data[key] = (data[key] || 0) + value;
                const row = await insert(data);
                return { row, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            const values = [];
            const assignments = changes(update, values);
            if (!assignments) return { row: existing, matchedCount: 1, modifiedCount: 0 };
            values.push(existing._id);
            const row = (await db.query(`UPDATE ${quote(table)} SET ${assignments} WHERE _id=$${values.length} RETURNING *`, values)).rows[0];
            return { row, matchedCount: 1, modifiedCount: 1 };
        });
    }
    class Query {
        constructor(filter, one = false, mutation) { this.filter = filter; this.one = one; this.mutation = mutation; }
        select(value) { this.selection = value; return this; }
        sort(value) { this.sorting = value; return this; }
        limit(value) { if (!Number.isInteger(value) || value < 1) throw new Error('Invalid SQL limit'); this.maximum = value; return this; }
        lean() { this.plain = true; return this; }
        then(resolve, reject) { this.promise ||= this.execute(); return this.promise.then(resolve, reject); }
        async execute() {
            if (this.mutation) return hydrate((await this.mutation()).row, this.selection, this.plain);
            const params = [];
            const predicate = where(this.filter, params);
            const sorting = order(this.sorting);
            const fields = projection(this.selection).map(quote).join(',');
            const limit = this.one ? 1 : this.maximum;
            const result = await db.query(`SELECT ${fields} FROM ${quote(table)} WHERE ${predicate}${sorting ? ' ORDER BY ' + sorting : ''}${limit ? ' LIMIT ' + limit : ''}`, params);
            return this.one ? hydrate(result.rows[0], this.selection, this.plain) : result.rows.map((row) => hydrate(row, this.selection, this.plain));
        }
    }
    class Model {
        constructor(data = {}, persisted = false) {
            Object.assign(this, persisted ? data : { ...structuredClone(spec.defaults || {}), ...data });
            Object.defineProperty(this, '_stored', { value: persisted ? structuredClone(data) : null, writable: true, enumerable: false });
        }
        toObject() { return Object.fromEntries(spec.columns.filter((key) => this[key] !== undefined && this[key] !== null).map((key) => [key, this[key]])); }
        toJSON() { return this.toObject(); }
        async save() {
            let row;
            if (!this._stored) row = await insert(this.toObject());
            else {
                const dirty = Object.fromEntries(Object.entries(this.toObject()).filter(([key, value]) => key !== '_id' && JSON.stringify(value) !== JSON.stringify(this._stored[key])));
                row = (await updateOne({ _id: this._id }, { $set: dirty })).row;
                if (!row) throw new Error('Record no longer exists');
            }
            const data = hydrate(row).toObject(); Object.assign(this, data); this._stored = structuredClone(data); return this;
        }
        static find(filter = {}) { return new Query(filter); }
        static findOne(filter = {}) { return new Query(filter, true); }
        static findById(id) { return Model.findOne({ _id: id }); }
        static findOneAndUpdate(filter, update, options = {}) { return new Query(filter, true, () => updateOne(filter, update, options)); }
        static updateOne(filter, update, options = {}) { return updateOne(filter, update, options).then(({ row, ...result }) => result); }
        static async exists(filter) { return Boolean(await Model.findOne(filter).select('_id').lean()); }
        static async countDocuments(filter = {}) { const values = []; return Number((await db.query(`SELECT count(*)::int AS count FROM ${quote(table)} WHERE ${where(filter, values)}`, values)).rows[0].count); }
        static async create(data) { return hydrate(await insert(data)); }
        static init() { return Promise.resolve(); }
        static async insertMany(documents) { return db.transaction(() => Promise.all(documents.map((document) => Model.create(document)))); }
        static async deleteMany(filter = {}) { const values = []; const result = await db.query(`DELETE FROM ${quote(table)} WHERE ${where(filter, values)}`, values); return { deletedCount: result.rowCount }; }
    }
    return Model;
}
module.exports = { repository, newId };
