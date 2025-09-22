// check-idl.js
const fs = require('fs');
const path = require('path');

function checkIDL() {
  try {
    const idlPath = path.join(__dirname, 'target/idl/reward_pool.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    
    console.log('IDL Structure:');
    console.log('Name:', idl.name);
    console.log('Version:', idl.version);
    console.log('Instructions:', idl.instructions?.length || 0);
    
    console.log('\nAccounts:');
    if (idl.accounts) {
      idl.accounts.forEach((account, i) => {
        console.log(`${i + 1}. ${account.name}`);
        console.log('   - size:', account.size);
        console.log('   - type keys:', Object.keys(account.type || {}));
      });
    } else {
      console.log('❌ No accounts found in IDL');
    }
    
    console.log('\nTypes:');
    if (idl.types) {
      idl.types.forEach((type, i) => {
        console.log(`${i + 1}. ${type.name}`);
      });
    } else {
      console.log('❌ No types found in IDL');
    }
    
    // Check for missing size properties
    if (idl.accounts) {
      const missingSize = idl.accounts.filter(acc => acc.size === undefined);
      if (missingSize.length > 0) {
        console.log('\n❌ Accounts missing size property:');
        missingSize.forEach(acc => console.log(`   - ${acc.name}`));
      } else {
        console.log('\n✅ All accounts have size property');
      }
    }
    
  } catch (error) {
    console.error('Error reading IDL:', error.message);
  }
}

checkIDL();