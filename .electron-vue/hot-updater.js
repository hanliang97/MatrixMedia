/**
 * power by biuuu
 */

const chalk = require("chalk");
const { join } = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')
const packageFile = require('../package.json')
const { build } = require("../config/index")
const { platform } = require("os")
const { ensureDir, emptyDir, copy, outputJSON, remove, stat, readFile } = require("fs-extra");

const platformName = platform().includes('win32') ? 'win' : platform().includes('darwin') ? 'mac' : 'linux'
const buildPath = join('.', 'build', `${platformName === 'mac' ? 'mac' : platformName + '-unpacked'}`)

const hash = (data, type = 'sha256') => {
    const hmac = crypto.createHmac(type, 'Sky')
    hmac.update(data)
    return hmac.digest('hex')
}

const createZip = (filePath, dest) => {
    const zip = new AdmZip()
    zip.addLocalFolder(filePath)
    zip.toBuffer()
    zip.writeZip(dest)
}

const start = async () => {
    console.log(chalk.green.bold(`\n  Start packing`))

    if (packageFile.build.asar) {
        console.log(
            "\n" +
            chalk.bgRed.white(" ERROR ") +
            "  " +
            chalk.red("Please make sure the build.asar option in the Package.json file is set to false") +
            "\n"
        );
        return;
    }

    if (build.hotPublishConfigName === '') {
        console.log(
            "\n" +
            chalk.bgRed.white(" ERROR ") +
            "  " +
            chalk.red("HotPublishConfigName is not set, which will cause the update to fail, please set it in the config/index.js \n")
            + chalk.red.bold(`\n  Packing failed \n`)
        );
        process.exit(1)
    }

    stat(join(buildPath, 'resources', 'app'), async (err, stats) => {
        if (err) {
            console.log(
                "\n" +
                chalk.bgRed.white(" ERROR ") +
                "  " +
                chalk.red("No resource files were found, please execute this command after the build command") +
                "\n"
            );
            return;
        }

        try {
            const packResourcesPath = join('.', 'build', 'resources', 'dist');
            const packPackagePath = join('.', 'build', 'resources');
            const resourcesPath = join('.', 'dist');
            const appPath = join('.', 'build', 'resources');
            const name = "app.zip";
            const outputPath = join('.', 'build', 'update');
            const zipPath = join(outputPath, name);

            await ensureDir(packResourcesPath);
            await emptyDir(packResourcesPath);
            await copy(resourcesPath, packResourcesPath);
            await outputJSON(join(packPackagePath, "package.json"), {
                name: packageFile.name,
                productName: packageFile.productName,
                version: packageFile.version,
                private: packageFile.private,
                description: packageFile.description,
                main: packageFile.main,
                author: packageFile.author,
                dependencies: packageFile.dependencies
            });
            await ensureDir(outputPath);
            await emptyDir(outputPath);
            createZip(appPath, zipPath);
            const buffer = await readFile(zipPath);
            const sha256 = hash(buffer);
            const hashName = sha256.slice(7, 12);
            await copy(zipPath, join(outputPath, `${hashName}.zip`));
            await remove(zipPath);
            await remove(appPath)
            await outputJSON(join(outputPath, `${build.hotPublishConfigName}.json`),
                {
                    version: packageFile.version,
                    name: `${hashName}.zip`,
                    hash: sha256
                }
            );
            console.log(
                "\n" + chalk.bgGreen.white(" DONE ") + "  " + "The resource file is packaged!\n"
            );
            console.log("File location: " + chalk.green(outputPath) + "\n");
        } catch (error) {
            console.log(
                "\n" +
                chalk.bgRed.white(" ERROR ") +
                "  " +
                chalk.red(error.message || error) +
                "\n"
            );
            process.exit(1)
        }
    });
}

start()