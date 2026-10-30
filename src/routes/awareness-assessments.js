const express = require('express');
const { z } = require('zod');
const { csrf } = require('../middleware/auth');
const { companies } = require('../utils/assessment');

const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const csvCell=value=>{let cell=String(value??'');if(/^[\s]*[=+@-]/.test(cell))cell="'"+cell;return '"'+cell.replace(/"/g,'""')+'"';};

function filters(query){
  const where=[],params=[];
  if(query.staffNumber){where.push('instr(lower(a.staff_number),lower(?))>0');params.push(String(query.staffNumber).trim().slice(0,64));}
  if(query.company){if(!companies.includes(query.company))throw Object.assign(new Error('Invalid company filter'),{status:400});where.push('a.company=?');params.push(query.company);}
  if(query.status){if(!['started','completed','needs_training'].includes(query.status))throw Object.assign(new Error('Invalid assessment status'),{status:400});where.push('a.status=?');params.push(query.status);}
  for(const [name,op] of [['from','>='],['to','<=']])if(query[name]){const value=String(query[name]);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(`${value}T00:00:00Z`)))throw Object.assign(new Error(`Invalid ${name} date`),{status:400});where.push(`a.scanned_at ${op} ?`);params.push(`${value}${name==='from'?'T00:00:00.000Z':'T23:59:59.999Z'}`);}
  return {clause:where.length?'WHERE '+where.join(' AND '):'',params};
}

module.exports=function createAwarenessRouter({db,audit}){
  const router=express.Router();
  router.get('/',asyncRoute(async(req,res)=>{
    const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));
    const {clause,params}=filters(req.query);
    const count=await db.get(`SELECT count(*) total FROM awareness_assessments a ${clause}`,params);
    const rows=await db.all(`SELECT a.id,a.staff_number,a.company,a.qr_code_id,q.reference code_reference,a.scanned_at,a.completed_at,a.status FROM awareness_assessments a JOIN qr_codes q ON q.id=a.qr_code_id ${clause} ORDER BY a.scanned_at DESC,a.id DESC LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
    const metrics=await db.get(`SELECT (SELECT count(*) FROM scan_events) scan_requests,(SELECT count(DISTINCT staff_number) FROM awareness_assessments) identified_employees,(SELECT count(*) FROM awareness_assessments) form_starts,(SELECT count(DISTINCT staff_number) FROM awareness_assessments WHERE completed_at IS NOT NULL) completed_employees,(SELECT count(DISTINCT staff_number) FROM awareness_assessments WHERE status='needs_training') follow_up_employees`);
    await audit(req.admin.id,'awareness_assessments.view','awareness_assessment',null);
    res.set('Cache-Control','no-store').json({rows,total:count.total,page,limit,metrics});
  }));
  router.get('/export.csv',asyncRoute(async(req,res)=>{
    const {clause,params}=filters(req.query);
    const rows=await db.all(`SELECT a.id,a.staff_number,a.company,a.phone_number,a.qr_code_id,q.reference code_reference,a.ip_address,a.scanned_at,a.completed_at,a.status FROM awareness_assessments a JOIN qr_codes q ON q.id=a.qr_code_id ${clause} ORDER BY a.scanned_at DESC,a.id DESC`,params);
    const fields=['id','staff_number','company','phone_number','qr_code_id','code_reference','ip_address','scanned_at','completed_at','status'];
    await audit(req.admin.id,'awareness_assessments.export','awareness_assessment',null,{rows:rows.length});
    res.set('Cache-Control','no-store').attachment('silafrica-awareness-assessments.csv').type('text/csv').send([fields.join(','),...rows.map(row=>fields.map(name=>csvCell(row[name])).join(','))].join('\r\n'));
  }));
  router.patch('/:id/follow-up',csrf,asyncRoute(async(req,res)=>{
    const input=z.object({needsTraining:z.boolean()}).strict().safeParse(req.body);
    if(!input.success)return res.status(400).json({error:'Invalid follow-up status'});
    const record=await db.get('SELECT id,status,completed_at FROM awareness_assessments WHERE id=?',[req.params.id]);
    if(!record)return res.sendStatus(404);
    const status=input.data.needsTraining?'needs_training':(record.completed_at?'completed':'started');
    await db.run('UPDATE awareness_assessments SET status=?,updated_at=? WHERE id=?',[status,new Date().toISOString(),record.id]);
    await audit(req.admin.id,input.data.needsTraining?'awareness.follow_up.required':'awareness.follow_up.cleared','awareness_assessment',record.id);
    res.set('Cache-Control','no-store').json({id:record.id,status});
  }));
  return router;
};
