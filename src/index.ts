import * as p from "@clack/prompts";
import { DataAPIClient } from "@datastax/astra-db-ts";
import chalk from "chalk";
import spawn from "cross-spawn";
import fs from "fs-extra";
import { type PackageJson } from "type-fest";

type Language = "ts" | "js";

type ProjectParams = {
  name: string;
  language: Language;
};

type AstraParams = {
  endpoint: string;
  token: string;
};

function multiLine(...text: string[]) {
  let multiLineText = text[0];

  for (let i = 1; i < text.length; i++) {
    multiLineText += `\n${chalk.dim("│")}  ${text[i]}`;
  }

  return multiLineText;
}

function note(...msg: string[]) {
  const s = p.spinner();

  s.start();
  s.stop(multiLine(...msg));
}

async function task(title: string, task: () => Promise<any>) {
  const s = p.spinner();

  s.start(title);

  await task();

  s.stop(`${title} ✅`);
}

async function exec(cmd: string, args?: string[], spinnerTitle?: string) {
  const execTask = () => {
    const child = spawn(cmd, args, { stdio: "ignore" });

    return new Promise((resolve, reject) => {
      child.on("close", (code) => {
        if (code !== 0) {
          reject(`"${spinnerTitle}" failed`);

          return;
        }

        resolve(null);
      });
    });
  };

  return spinnerTitle ? task(spinnerTitle, execTask) : execTask();
}

async function configureProject(): Promise<ProjectParams> {
  const params = await p.group({
    name: () =>
      p.text({
        message: "What is the name of your future GenAI app?",
        placeholder: "my-gen-ai-app",
        defaultValue: "my-gen-ai-app",
      }),
    language: () => {
      return p.select({
        message: "Will you be using TypeScript or JavaScript?",
        options: [
          { value: "ts", label: "TypeScript" },
          { value: "js", label: "JavaScript" },
        ],
        initialValue: "ts",
      });
    },
  });

  return { ...params, language: params.language as Language };
}

async function configureAstra(): Promise<AstraParams> {
  note(
    "Now let's make sure you have a working Astra DB connection.",
    "To proceed, please make sure you have and Astra account and a Astra Vector Database ready to go.",
    "Read here for details: https://docs.datastax.com/en/astra-db-serverless/get-started/quickstart.html#create-a-serverless-vector-database",
  );

  await task("Press any key when ready", async () => {
    return new Promise((resolve) => {
      process.stdin.on("data", (_) => {
        resolve(null);
      });
    });
  });

  while (true) {
    const astraParams = await p.group({
      endpoint: () =>
        p.text({
          message: "What is your database's API endpoint?",
          placeholder: "https://<DB ID>-<REGION>.apps.astra.datastax.com",
          validate: (value) => {
            if (
              value.length === 0 ||
              !value.startsWith("https://") ||
              !value.includes(".apps.astra.datastax.com") // TODO: Use regex?
            )
              return "Valid API endpoint is required!";
          },
        }),
      token: () =>
        p.text({
          message: "And what is your Astra application token?",
          placeholder: "AstraCS:XXX",
          validate: (value) => {
            if (value.length === 0 || !value.startsWith("AstraCS:"))
              return "Valid token is required!";
          },
        }),
    });

    const client = new DataAPIClient(astraParams.token);

    try {
      await client.db(astraParams.endpoint).listCollections();

      note("Successfully connected to Astra DB!");

      return astraParams;
    } catch (e) {
      // TODO: Memorize latest values and use them as defaults on next iteration.
      //       Maybe even persist to a file - it's painful to enter this every time.
      note("Failed to connect :( Let's start over...");
    } finally {
      await client.close();
    }
  }
}

async function createNextJsApp(params: ProjectParams) {
  return exec(
    "npx", // TODO: Support other package managers.
    [
      "create-next-app@canary", // TODO: Revert to 'latest' when '--skip-install' is available there.
      params.name,
      `--${params.language}`,
      "--tailwind",
      "--no-eslint",
      "--no-turbo",
      "--app",
      "--no-src-dir",
      "--import-alias",
      "@/*",
      "--skip-install",
    ],
  );
}

async function createEnv(params: AstraParams) {
  return fs.writeFile(
    ".env",
    `ASTRA_DB_ENDPOINT=${params.endpoint}\nASTRA_DB_TOKEN=${params.token}`,
  );
}

async function addDependencies() {
  const packageJson = (await fs.readJson("package.json")) as PackageJson;

  packageJson.dependencies = {
    ...packageJson.dependencies,
    "@datastax/astra-db-ts": "^1.4.1", // TODO: Which version to use?
  };

  return fs.writeJson("package.json", packageJson, {
    spaces: 2,
  });
}

async function installIfNeeded() {
  const install = (
    await p.group({
      install: () =>
        p.confirm({
          message: "Do you want us to install dependencies?",
          initialValue: true,
        }),
    })
  ).install;

  // TODO: Support other package managers.
  if (install) return exec("npm", ["install"], "Installing dependencies");
}

async function tryGitCommit() {
  try {
    await exec("git", ["add", "-A"]);
    await exec("git", ["commit", "-m", "Added GenAI content"]);
  } catch (_) {}
}

async function main() {
  p.intro("Congrats! You're just several steps from creating a GenAI app!");

  const projectParams = await configureProject();
  const astraParams = await configureAstra();

  await task("Generating project", async () => {
    await createNextJsApp(projectParams);

    process.chdir(`./${projectParams.name}`);

    await createEnv(astraParams);
    await addDependencies();

    // TODO: Add content.
  });

  await installIfNeeded();
  await tryGitCommit();

  p.outro("You're all set!");
}

main().catch((err) => {
  console.log("Aborting...");

  process.exit(1);
});
