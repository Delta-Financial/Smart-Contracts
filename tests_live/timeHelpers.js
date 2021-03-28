const advanceTimeAndBlock = async (time) => {
    await _advanceTime(time);
    await _advanceBlock();

    return Promise.resolve(web3.eth.getBlock('latest'));
}

const _advanceTime = (time) => {
    if(typeof(time) === 'string') {
        time = parseInt(time);
    }
    if(typeof(time) === 'object') {
        time = parseInt(time.toString());
    }
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [time],
            id: new Date().getTime()
        }, (err, result) => {
            if (err) { return reject(err); }
            return resolve(result);
        });
    });
}

const _advanceBlock = () => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_mine",
            id: new Date().getTime()
        }, (err, result) => {
            if (err) { return reject(err); }
            // const newBlockHash = web3.eth.getBlock('latest').hash;
            // return resolve(newBlockHash)
            resolve(result);
        });
    });
}

// Advance N blocks
const _advanceBlocks = (n = 1) => {
    if(n >= 10) {
        YouCantDoThatGIF;
    }
    calls = [];
    for(let i=0;i<n;i++) {
        calls.push(
            new Promise((resolve, reject) => {
                web3.currentProvider.send({
                    jsonrpc: "2.0",
                    method: "evm_mine",
                    id: new Date().getTime()
                }, (err, result) => {
                    if (err) { return reject(err) }
                    else { resolve(result) }
                });
            })
        )
    }
    return Promise.all(calls);
}

module.exports = {
    advanceTimeAndBlock
}