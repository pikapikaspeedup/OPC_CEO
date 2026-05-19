import { describe, test, expect } from "vitest";
import {
	checkBashSecurity,
	initSecurityCore,
	matchesPermissionRule,
	isDangerousCommand,
	splitCompoundCommand,
	getOutputRedirections,
	checkSedConstraints,
	checkPathConstraints,
	checkPermissionMode,
	checkCommandOperatorPermissions,
} from "../bash-security-adapter";

describe("bash-security-adapter integration", () => {
	test("allows safe commands", () => {
		expect(checkBashSecurity("ls -la").allowed).toBe(true);
		expect(checkBashSecurity("cat file.txt").allowed).toBe(true);
		expect(checkBashSecurity("git status").allowed).toBe(true);
		expect(checkBashSecurity("echo hello").allowed).toBe(true);
	});

	test("blocks command injection via $()", () => {
		const result = checkBashSecurity("echo $(whoami)");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("command substitution");
	});

	test("blocks backtick injection", () => {
		const result = checkBashSecurity("echo `rm -rf /`");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("backtick");
	});

	test("blocks output redirection", () => {
		const result = checkBashSecurity("echo payload > /etc/passwd");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("redirection");
	});

	test("blocks input redirection", () => {
		const result = checkBashSecurity("cat < /etc/shadow");
		expect(result.allowed).toBe(false);
	});

	test("blocks control characters", () => {
		const result = checkBashSecurity("echo safe\x00; rm -rf /");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("control characters");
	});

	test("blocks Zsh dangerous commands", () => {
		expect(checkBashSecurity("zmodload zsh/system").allowed).toBe(false);
		expect(checkBashSecurity("ztcp evil.com 80").allowed).toBe(false);
	});

	test("blocks ${} parameter substitution", () => {
		const result = checkBashSecurity("echo ${HOME}");
		expect(result.allowed).toBe(false);
	});

	test("blocks brace expansion attack", () => {
		const result = checkBashSecurity("{rm,-rf,/}");
		expect(result.allowed).toBe(false);
	});

	test("blocks unicode whitespace", () => {
		const result = checkBashSecurity("echo\u00A0test");
		expect(result.allowed).toBe(false);
	});

	test("blocks process substitution", () => {
		expect(checkBashSecurity("diff <(cat a) file").allowed).toBe(false);
	});

	test("blocks /proc/environ access", () => {
		expect(checkBashSecurity("cat /proc/self/environ").allowed).toBe(false);
	});

	test("blocks incomplete commands starting with flags", () => {
		expect(checkBashSecurity("-rf /").allowed).toBe(false);
	});

	test("analytics callback receives events", () => {
		const events: string[] = [];
		initSecurityCore({ logger: (event) => events.push(event) });

		checkBashSecurity("echo $(whoami)");
		expect(events.length).toBeGreaterThan(0);

		// Reset
		initSecurityCore({ logger: () => {} });
	});

	test("allows /dev/null redirection", () => {
		expect(checkBashSecurity("echo test 2>&1").allowed).toBe(true);
	});

	test("raw result contains full PermissionResult", () => {
		const result = checkBashSecurity("echo $(whoami)");
		expect(result.raw).toBeDefined();
		expect(result.raw.behavior).toBe("ask");
	});
});

describe("permission rule matching", () => {
	test("exact match", () => {
		expect(matchesPermissionRule("ls -la", "ls -la")).toBe(true);
		expect(matchesPermissionRule("ls", "ls -la")).toBe(false);
	});

	test("prefix match with :*", () => {
		expect(matchesPermissionRule("npm install express", "npm:*")).toBe(true);
		expect(matchesPermissionRule("npm", "npm:*")).toBe(true);
		expect(matchesPermissionRule("npx create", "npm:*")).toBe(false);
	});

	test("wildcard match", () => {
		expect(matchesPermissionRule("git commit -m 'hello'", "git commit *")).toBe(true);
		expect(matchesPermissionRule("yarn add express", "git commit *")).toBe(false);
	});
});

describe("dangerous command detection", () => {
	test("detects dangerous interpreters", () => {
		expect(isDangerousCommand("python -c 'import os'")).toBe(true);
		expect(isDangerousCommand("node -e 'process.exit()'")).toBe(true);
		expect(isDangerousCommand("eval 'rm -rf /")).toBe(true);
		expect(isDangerousCommand("sudo rm -rf /")).toBe(true);
	});

	test("allows safe commands", () => {
		expect(isDangerousCommand("ls -la")).toBe(false);
		expect(isDangerousCommand("cat file.txt")).toBe(false);
		expect(isDangerousCommand("echo hello")).toBe(false);
	});
});

describe("Phase 3: compound command splitting", () => {
	test("splits simple && chains", () => {
		const parts = splitCompoundCommand("cd /tmp && ls");
		expect(parts.length).toBeGreaterThanOrEqual(2);
	});

	test("splits pipe chains", () => {
		const parts = splitCompoundCommand("cat file | grep hello");
		expect(parts.length).toBeGreaterThanOrEqual(2);
	});

	test("single command returns at least one part", () => {
		const parts = splitCompoundCommand("ls -la");
		expect(parts.length).toBeGreaterThanOrEqual(1);
	});
});

describe("Phase 3: output redirection extraction", () => {
	test("extracts output redirections", () => {
		const result = getOutputRedirections("echo test > out.txt");
		expect(result.redirections.length).toBeGreaterThan(0);
		expect(result.redirections[0].target).toBe("out.txt");
		expect(result.commandWithoutRedirections).toBe("echo test");
	});

	test("no redirections for simple command", () => {
		const result = getOutputRedirections("echo test");
		expect(result.redirections.length).toBe(0);
	});
});

describe("Phase 3: sub-validators are callable", () => {
	test("checkSedConstraints is callable", () => {
		expect(typeof checkSedConstraints).toBe("function");
	});

	test("checkPathConstraints is callable", () => {
		expect(typeof checkPathConstraints).toBe("function");
	});

	test("checkPermissionMode is callable", () => {
		expect(typeof checkPermissionMode).toBe("function");
	});

	test("checkCommandOperatorPermissions is callable", () => {
		expect(typeof checkCommandOperatorPermissions).toBe("function");
	});
});
