const {test}=require('node:test');
const assert=require('node:assert/strict');
const {companies,normalizeKenyanPhone,normalizeStaffNumber}=require('../src/utils/assessment');

test('Kenyan mobile formats normalize consistently and invalid values are rejected',()=>{
  assert.deepEqual(companies,['SKL','CHRS','POL']);
  assert.equal(normalizeKenyanPhone('0712 345 678'),'+254712345678');
  assert.equal(normalizeKenyanPhone('0112-345-678'),'+254112345678');
  assert.equal(normalizeKenyanPhone('+254 712 345 678'),'+254712345678');
  assert.equal(normalizeKenyanPhone('254112345678'),'+254112345678');
  for(const value of ['071234567','0612345678','+254612345678','+25471234567899','not a number'])assert.equal(normalizeKenyanPhone(value),null);
});

test('staff numbers are required, bounded and normalized for consistent counting',()=>{
  assert.equal(normalizeStaffNumber(' emp-002 '),'EMP-002');
  assert.equal(normalizeStaffNumber(''),null);
  assert.equal(normalizeStaffNumber('x'.repeat(65)),null);
  assert.equal(normalizeStaffNumber('STAFF\n1'),null);
});
