const fs = require('fs-extra');
const path = require('path');

const {
  TASK_COMPILE,
} = require('hardhat/builtin-tasks/task-names');

const NAME = 'gas-estimates';
const DESC = 'Use the artifacts\' build-info to report the gas estimates of each artifacts\'';

// Can be used to post-process the gas estimate data
const _parseGasEstimate = async gasEstimate => {
  return gasEstimate;
};

task(NAME, DESC).setAction(async (_, hre) => {
  const sourceRoot = path.resolve(hre.config.paths.root, hre.config.paths.sources);
  const storageLayoutDirectory = path.resolve(hre.config.paths.root, 'gas-estimates');
  await fs.remove(storageLayoutDirectory);

  try {
    await hre.run(TASK_COMPILE);
  } catch (e) {
    console.log('Failed to compile contracts before removing logs.');
    process.exit(1);
  }

  console.log('Extracting gas estimates...');
  const artifactFqns = await hre.artifacts.getAllFullyQualifiedNames();
  await Promise.all(artifactFqns.map(async fqn => {
    const [sourceFile, artifactName] = fqn.split(':');
    const relativeSourcePath = path.relative(sourceRoot, sourceFile);

    if (!relativeSourcePath.startsWith('..')) {
      const directory = path.resolve(storageLayoutDirectory, sourceFile);
      const outputFilename = path.resolve(directory, `${artifactName}.json`);
      const buildInfo = await hre.artifacts.getBuildInfo(fqn);
      const rawGasEstimates = buildInfo.output.contracts[sourceFile][artifactName] &&
      buildInfo.output.contracts[sourceFile][artifactName].evm &&
      buildInfo.output.contracts[sourceFile][artifactName].evm.gasEstimates;
      
      const gasEstimate = await _parseGasEstimate(rawGasEstimates);

      if (gasEstimate) {
        await fs.ensureDir(directory);
        await fs.writeFile(outputFilename, JSON.stringify(gasEstimate, null, 2));
      }
    }
  }));

  console.log('Done');
});
