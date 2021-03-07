const fs = require('fs-extra');
const path = require('path');

const {
  TASK_COMPILE,
} = require('hardhat/builtin-tasks/task-names');

const NAME = 'storage-layout';
const DESC = 'Use the artifacts\' build-info to report the storage layout of each artifacts\' storage layout if any';

// Can be used to post-process the storage layout json.
const _parseStorageLayout = async storageLayout => {
  if (!storageLayout || storageLayout.storage.length == 0) {
    return false;
  }
  return storageLayout;
};

task(NAME, DESC).setAction(async (_, hre) => {
  const sourceRoot = path.resolve(hre.config.paths.root, hre.config.paths.sources);
  const storageLayoutDirectory = path.resolve(hre.config.paths.root, 'storage-layouts');
  await fs.remove(storageLayoutDirectory);

  try {
    await hre.run(TASK_COMPILE);
  } catch (e) {
    console.log('Failed to compile contracts before removing logs.');
    process.exit(1);
  }

  console.log('Extracting storage layout files...');
  const artifactFqns = await hre.artifacts.getAllFullyQualifiedNames();
  await Promise.all(artifactFqns.map(async fqn => {
    const [sourceFile, artifactName] = fqn.split(':');
    const relativeSourcePath = path.relative(sourceRoot, sourceFile);

    if (!relativeSourcePath.startsWith('..')) {
      const directory = path.resolve(storageLayoutDirectory, sourceFile);
      const outputFilename = path.resolve(directory, `${artifactName}.json`);
      const buildInfo = await hre.artifacts.getBuildInfo(fqn);
      const rawStorageLayout = buildInfo.output.contracts[sourceFile][artifactName] && buildInfo.output.contracts[sourceFile][artifactName].storageLayout;
      const storageLayout = await _parseStorageLayout(rawStorageLayout);

      if (storageLayout) {
        await fs.ensureDir(directory);
        await fs.writeFile(outputFilename, JSON.stringify(storageLayout, null, 2));
      }
    }
  }));

  console.log('Done');
});
