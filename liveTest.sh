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

function run_all_delta_tests() {
    PRODUCTION=$1
    NETWORK=$2

    if [ $PRODUCTION == true ]; then
        # This instanciate the delta contracts from what's defined inside contants.js with `at()`
        # instead of deploying local instances with `new()`
        echo "Running tests using live contracts"
        export IS_PRODUCTION=true
    fi

    tests=(
        "tests_live/delta/dfv.test.js"
        "tests_live/delta/rlp.test.js"
        "tests_live/delta/token.test.js"
        "tests_live/delta/bucket_test_worstcase.test.js"
        "tests_live/delta/router.test.js"
        "tests_live/delta/distributor.test.js"
        "tests_live/delta/locked_liquidity.test.js"
        "tests_live/delta/post_lsw.test.js"
        "tests_live/live.test.js"
    )

    for test in "${tests[@]}"
    do
        echo "Runnning ${test}..."
        npx hardhat test --show-stack-traces --network ${NETWORK} "${test}" || exit 1;
    done
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

# if [[ "${ARGS}" == *"--token"* ]]; then
#     NEWARGS="--config hardhat.v076.config.js"
#     ARGS=`echo ${ARGS//--token/} | xargs echo -n`
# fi
# This is so common, let's just default to it
NEWARGS="--config hardhat.v076.config.js"

if [[ "${ARGS}" == *"--nomine"* ]]; then
    NEWARGS="--config hardhat.v076.nomine.config.js"
    ARGS=`echo ${ARGS//--nomine/} | xargs echo -n`
fi

if [[ "${ARGS}" == *"--delta-all-prod"* ]]; then
    run_all_delta_tests true $NETWORK
    exit 0
fi

if [[ "${ARGS}" == *"--delta-all"* ]]; then
    run_all_delta_tests false $NETWORK
    exit 0
fi

if ! [ -z "${ARGS}" ]; then
    TEST="${ARGS}"
fi

echo "Running test ${TEST} on ${NETWORK} node..."
npx hardhat test ${NEWARGS} --show-stack-traces --network ${NETWORK} "${TEST}"
