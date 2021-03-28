const { triggerIntervalMine } = require("../timeHelpers");

const getContractAtOrDeploy = async (address, artifact, ...parameters) => {
  if (process.env.IS_PRODUCTION) {
    if(!address) {
      throw new Error("Must be using address in production testing");
    }
    return artifact.at(address);
  }

  return artifact.new(...parameters);
};

/**
 * Not completely working
 */
const getContractAtOrDeployNoMine = async (address, artifact, ...parameters) => {
  if (process.env.IS_PRODUCTION) {
    if(!address) {
      throw new Error("Must be using address in production testing");
    }
    return artifact.at(address);
  }

  const promise = artifact.new(...parameters);
  await new Promise(r => setTimeout(r, 500));
  await triggerIntervalMine();
  const contract = await promise;

  Object.keys(contract).filter(key => {
    return typeof contract[key] === 'function' &&
    key !== "constructor"
  }).forEach(fn => {
    const originalFn = contract[fn];
    contract[fn] = async (...parameters) => {
      console.log(`${fn.toString()} called... `);
      const promise = originalFn(...parameters);

      await new Promise(r => setTimeout(r, 500));
      await triggerIntervalMine();

      return promise;
    }
  });
  
  console.log('Deploying...');
  return contract;
};

const isContractDeployed = async address => {
  console.log("isContractDeployed 1");
  const code = await web3.eth.getCode(address);
  console.log("isContractDeployed 2");
  return code !== '0x';
};

module.exports = {
  isContractDeployed,
  getContractAtOrDeploy,
  getContractAtOrDeployNoMine
};
