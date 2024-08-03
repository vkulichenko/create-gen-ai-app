"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cross_spawn_1 = __importDefault(require("cross-spawn"));
const p = __importStar(require("@clack/prompts"));
const astra_db_ts_1 = require("@datastax/astra-db-ts");
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
function multiLine(...text) {
    let multiLineText = text[0];
    for (let i = 1; i < text.length; i++) {
        // multiLineText += `\n${chalk.dim("│")}  ${text[i]}`; // FIXME
        multiLineText += `\n   ${text[i]}`;
    }
    return multiLineText;
}
function note(...msg) {
    const s = p.spinner();
    s.start();
    s.stop(multiLine(...msg));
}
function task(title, task) {
    return __awaiter(this, void 0, void 0, function* () {
        const s = p.spinner();
        s.start(title);
        yield task();
        s.stop(`${title} ✅`);
    });
}
function exec(cmd, args, spinnerTitle) {
    return __awaiter(this, void 0, void 0, function* () {
        const execTask = () => {
            const child = (0, cross_spawn_1.default)(cmd, args, { stdio: "ignore" });
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
    });
}
function createNextJsApp(params) {
    return __awaiter(this, void 0, void 0, function* () {
        return exec("npx", // TODO: Support other package managers.
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
        ]);
    });
}
function install(name) {
    return __awaiter(this, void 0, void 0, function* () {
        // TODO: Support other package managers.
        return exec("npm", ["--prefix", `./${name}`, "install", `./${name}`], "Installing dependencies");
    });
}
function configureAstra() {
    return __awaiter(this, void 0, void 0, function* () {
        note("To get started, please make sure you have and Astra account and a Astra Vector Database ready to go.", "Read here for details: https://docs.datastax.com/en/astra-db-serverless/get-started/quickstart.html#create-a-serverless-vector-database");
        // TODO: Ask for confirmation?
        while (true) {
            const astraParams = yield p.group({
                endpoint: () => p.text({
                    message: "What is the database's API endpoint?",
                    placeholder: "https://<DB ID>-<REGION>.apps.astra.datastax.com",
                    validate: (value) => {
                        if (value.length === 0 ||
                            !value.startsWith("https://") ||
                            !value.includes(".apps.astra.datastax.com") // TODO: Use regex?
                        )
                            return "Valid API endpoint is required!";
                    },
                }),
                token: () => p.text({
                    message: "And what is the application token?",
                    placeholder: "AstraCS:XXX",
                    validate: (value) => {
                        if (value.length === 0 || !value.startsWith("AstraCS:"))
                            return "Valid token is required!";
                    },
                }),
            });
            const client = new astra_db_ts_1.DataAPIClient(astraParams.token);
            try {
                yield client.db(astraParams.endpoint).listCollections();
                return astraParams;
            }
            catch (e) {
                // TODO: Memorize latest values and use them as defaults on next iteration.
                //       Maybe even persist to a file - it's painful to enter this every time.
                note("Failed to connect :( Let's start over...");
            }
            finally {
                yield client.close();
            }
        }
    });
}
function configureProject() {
    return __awaiter(this, void 0, void 0, function* () {
        const params = yield p.group({
            name: () => p.text({
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
            tailwind: () => p.confirm({
                message: "Will you be using Tailwind CSS?",
                initialValue: true,
            }),
            eslint: () => p.confirm({
                message: "Will you be using ESLint?",
                initialValue: false,
            }),
            install: () => p.confirm({
                message: "Do you want us to install dependencies?",
                initialValue: true,
            }),
        });
        return params;
    });
}
function createEnv(params) {
    return __awaiter(this, void 0, void 0, function* () {
        return (0, fs_extra_1.writeFile)(path_1.default.join(params.name, ".env"), `ASTRA_DB_ENDPOINT=${params.endpoint}\nASTRA_DB_TOKEN=${params.token}`);
    });
}
function addDependencies(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const packageJson = (yield (0, fs_extra_1.readJson)(path_1.default.join(params.name, "package.json")));
        packageJson.dependencies = Object.assign(Object.assign({}, packageJson.dependencies), { "@datastax/astra-db-ts": "^1.4.1" });
        return (0, fs_extra_1.writeJson)(path_1.default.join(params.name, "package.json"), packageJson, {
            spaces: 2,
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        p.intro("Congrats! You're just several steps from creating a GenAI app!");
        const astraParams = yield configureAstra();
        note("Successfully connected to Astra DB! Just few more questions...");
        const projectParams = yield configureProject();
        const params = Object.assign(Object.assign({}, astraParams), projectParams);
        yield task("Generating project", () => __awaiter(this, void 0, void 0, function* () {
            yield createNextJsApp(params);
            yield createEnv(params);
            yield addDependencies(params);
            // TODO: Add content.
        }));
        // TODO: Git commit.
        if (params.install)
            yield install(params.name);
        p.outro("Yay!! You're all set!");
    });
}
main().catch((err) => {
    console.log("Aborting...");
    process.exit(1);
});
