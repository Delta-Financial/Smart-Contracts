const { network, web3 } = require('hardhat');
const hardhatConfig = require('../../hardhat.config');
const { artifacts } = require('hardhat');

const send = (method, params = []) => new Promise((resolve, reject) => {
  web3.currentProvider.send(
    { jsonrpc: '2.0', id: Date.now(), method, params },
    (err, res) => err ? reject(err) : resolve(res),
  );
});

const getBlockNumber = async () => {
  const { result } = await send('eth_blockNumber');
  return parseInt(result, 16);
};

const setNextBlockTimestamp = async timestamp => {
  await network.provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [timestamp]
  });
};

const resertFork = async (blockNumber) => {
  blockNumber =  blockNumber || hardhatConfig.networks.hardhat.forking.blockNumber;
  await network.provider.request({
    method: "hardhat_reset",
    params: [{
      forking: {
        jsonRpcUrl: hardhatConfig.networks.hardhat.forking.url,
        blockNumber,
      }
    }]
  });

  const currentBlockNumber = await getBlockNumber();
  if (currentBlockNumber !== blockNumber) {
      throw new Error(`Failed to changed block number to ${blockNumber}, currently at ${currentBlockNumber}`);
  }
};

const getLatestBlock = () => {
  return web3.eth.getBlock('latest');
};

module.exports = {
  resertFork,
  setNextBlockTimestamp,
  getLatestBlock
};
