import spawn from "cross-spawn";
import * as p from "@clack/prompts";
import { DataAPIClient } from "@datastax/astra-db-ts";
import { writeFile, readJson, writeJson } from "fs-extra";
import path from "path";
import { type PackageJson } from "type-fest";

type AstraParams = {
  endpoint: string;
  token: string;
};

type ProjectParams = {
  name: string;
  language: string;
  tailwind: boolean;
  eslint: boolean;
  install: boolean;
};

type Params = AstraParams & ProjectParams;

function multiLine(...text: string[]) {
  let multiLineText = text[0];

  for (let i = 1; i < text.length; i++) {
    // multiLineText += `\n${chalk.dim("│")}  ${text[i]}`; // FIXME
    multiLineText += `\n   ${text[i]}`;
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

async function exec(cmd: string, args: string[], spinnerTitle?: string) {
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

async function createNextJsApp(params: ProjectParams) {
  return exec(
    "npx", // TODO: Support other package managers.
    [
      "create-next-app@canary", // TODO: Revert to 'latest' when '--skip-install' is available there.
      params.name,
      `--${params.language}`,
      params.tailwind ? "--tailwind" : "--no-tailwind",
      params.eslint ? "--eslint" : "--no-eslint",
      "--no-turbo",
      "--app",
      "--no-src-dir",
      "--import-alias",
      "@/*",
      "--skip-install",
    ],
  );
}

async function install(name: string) {
  // TODO: Support other package managers.
  return exec(
    "npm",
    ["--prefix", `./${name}`, "install", `./${name}`],
    "Installing dependencies",
  );
}

async function configureAstra(): Promise<AstraParams> {
  note(
    "To get started, please make sure you have and Astra account and a Astra Vector Database ready to go.",
    "Read here for details: https://docs.datastax.com/en/astra-db-serverless/get-started/quickstart.html#create-a-serverless-vector-database",
  );

  // TODO: Ask for confirmation?

  while (true) {
    const astraParams = await p.group({
      endpoint: () =>
        p.text({
          message: "What is the database's API endpoint?",
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
          message: "And what is the application token?",
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
    tailwind: () =>
      p.confirm({
        message: "Will you be using Tailwind CSS?",
        initialValue: true,
      }),
    eslint: () =>
      p.confirm({
        message: "Will you be using ESLint?",
        initialValue: false,
      }),
    install: () =>
      p.confirm({
        message: "Do you want us to install dependencies?",
        initialValue: true,
      }),
  });

  return params;
}

async function createEnv(params: Params) {
  return writeFile(
    path.join(params.name, ".env"),
    `ASTRA_DB_ENDPOINT=${params.endpoint}\nASTRA_DB_TOKEN=${params.token}`,
  );
}

async function addDependencies(params: Params) {
  const packageJson = (await readJson(
    path.join(params.name, "package.json"),
  )) as PackageJson;

  packageJson.dependencies = {
    ...packageJson.dependencies,
    "@datastax/astra-db-ts": "^1.4.1", // TODO: Which version to use?
  };

  return writeJson(path.join(params.name, "package.json"), packageJson, {
    spaces: 2,
  });
}

async function main() {
  p.intro("Congrats! You're just several steps from creating a GenAI app!");

  const params = {
    ...(await configureAstra()),
    ...(await configureProject()),
  };

  await task("Generating project", async () => {
    await createNextJsApp(params);
    await createEnv(params);
    await addDependencies(params);

    // TODO: Add content.
  });

  // TODO: Git commit.

  if (params.install) await install(params.name);

  p.outro("Yay!! You're all set!");
}

main().catch((err) => {
  console.log("Aborting...");

  process.exit(1);
});
