import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !publishableKey || !secretKey) {
  console.error(
    "Configuração ausente. Adicione SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SECRET_KEY) ao .env.local.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function ask(question) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer);
    });
  });
}

function askHidden(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Execute este comando em um terminal interativo.");
  }

  readline.emitKeypressEvents(process.stdin);
  const previousRawMode = process.stdin.isRaw;
  let value = "";

  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    const finish = () => {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(Boolean(previousRawMode));
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onKeypress = (text, key = {}) => {
      if (key.ctrl && key.name === "c") {
        finish();
        reject(new Error("Operação cancelada."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        finish();
        resolve(value);
        return;
      }

      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }

      if (text && !/[\u0000-\u001f\u007f]/u.test(text) && !key.meta) {
        value += text;
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

async function findUserByEmail(email) {
  const perPage = 1_000;

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === email,
    );
    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  throw new Error("A busca excedeu o limite seguro de usuários.");
}

async function main() {
  const email = String(await ask("E-mail da conta: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Informe um e-mail válido.");
  }

  const user = await findUserByEmail(email);
  if (!user) throw new Error("Usuário não encontrado neste projeto Supabase.");

  const password = String(await askHidden("Nova senha (não será exibida): "));
  const confirmation = String(await askHidden("Repita a nova senha: "));

  if (password.length < 8) {
    throw new Error("A nova senha deve possuir pelo menos 8 caracteres.");
  }
  if (password !== confirmation) throw new Error("As senhas não coincidem.");

  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    password,
  });
  if (error) throw error;

  const verifier = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { error: verificationError } = await verifier.auth.signInWithPassword({
    email,
    password,
  });
  if (verificationError) {
    const code = verificationError.code ?? `status_${verificationError.status ?? "desconhecido"}`;
    throw new Error(`a senha foi atualizada, mas o teste de login falhou (${code})`);
  }
  await verifier.auth.signOut();

  console.log("Senha atualizada e login conferido com sucesso.");
  if (!user.email_confirmed_at) {
    console.warn(
      "Atenção: o e-mail desta conta ainda não está confirmado. A alteração da senha não confirma o e-mail.",
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Falha desconhecida.";
  console.error(`Não foi possível atualizar a senha: ${message}`);
  process.exitCode = 1;
});
