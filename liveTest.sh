#!/usr/bin/env bash
cd "${0%/*}"

TEST="tests_live/live.test.js"
NETWORK="hardhat"
NEWARGS=""
ARGS="${@}"

function usage()
{
   echo
   echo "Usage: liveTest.sh [OPTION]... [FILE]"
   echo "Run the CORE live test using hardhat mainnet fork."
   echo "Example: liveTest.sh --build tests_live/mytest.test.js"
   echo
   echo "Options:"
   echo "  --rebuild   Rebuild the solidity files before running the tests"
   echo "  --local     Run the test on the local hardhat node (npx hardhat node)"
   echo "  --help      Show this help."
   echo
   echo "When FILE is unspecified, ${TEST} will be used."
   echo "Report bugs to: dev@cvault.finance"
   echo
}

if [[ "${ARGS}" == *"--help"* || "${ARGS}" == *"-h"* ]]; then
    usage
    exit 0
fi

if [[ "${ARGS}" == *"--local"* ]]; then
    NETWORK="localhost"
    ARGS=`echo ${ARGS//--local/} | xargs echo -n`
fi

if [[ "${ARGS}" == *"--rebuild"* ]]; then
    echo "Rebuilding..."
    yarn run build
    ARGS=`echo ${ARGS//--rebuild/} | xargs echo -n`
fi

if [[ "${ARGS}" == *"--token"* ]]; then
    NEWARGS="--config hardhat.v076.config.js"
    ARGS=`echo ${ARGS//--token/} | xargs echo -n`
fi

if ! [ -z "${ARGS}" ]; then
    TEST="${ARGS}"
fi

echo "Running test ${TEST} on ${NETWORK} node..."
npx hardhat test ${NEWARGS} --show-stack-traces --network ${NETWORK} "${TEST}"
