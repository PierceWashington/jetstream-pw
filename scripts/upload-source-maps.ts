#!/usr/bin/env node
import 'dotenv/config';
import { GitRevisionPlugin } from 'git-revision-webpack-plugin';
import { $, chalk, fs, path } from 'zx'; // https://github.com/google/zx

const gitRevisionPlugin = new GitRevisionPlugin();

/**
 * Script to generate a new package version
 * [WIP]
 */

void (async function () {
  if (process.env.SKIP_ROLLBAR) {
    console.log(chalk.yellow('Skipping Rollbar asset upload'));
    return;
  }
  console.log(chalk.blue(`Uploading sourcemaps to Rollbar`));
  const distPath = path.join(__dirname, '../dist/apps/jetstream');
  let version = fs.readFileSync(path.join(distPath, 'VERSION'), 'utf8');
  version = (version || process.env.GIT_VERSION || gitRevisionPlugin.version()) as string;
  const url = 'https://api.rollbar.com/api/1/sourcemap';
  const accessToken = process.env.ROLLBAR_SERVER_TOKEN;

  console.log(chalk.blue(`Version: ${version}`));

  if (!accessToken) {
    console.error(chalk.redBright('🚫 COULD NOT UPLOAD SOURCEMAPS - ACCESS TOKEN NOT SET 🚫'));
    return;
  }

  $.verbose = false;
  console.time();
  const files = (await fs.readdir(distPath)).filter((item) => item.endsWith('.js.map')).sort();

  for (const file of files) {
    try {
      const filePath = path.join(distPath, file);
      const minifiedUrl = `//dynamichost/${file.replace('.js.map', '.js')}`;

      console.log(chalk.blue(`- ${file}`));

      await $`curl ${url} -F access_token=${accessToken} -F version=${version} -F minified_url=${minifiedUrl} -F source_map=@${filePath}`;
    } catch (ex: any) {
      console.error(chalk.redBright('🚫 Error uploading sourcemap', ex.message));
    }
  }
  console.timeEnd();
})();
