export interface GuidelineScore {
	rule: number;
	score: number;
}

export interface CommentViolation {
	id: number;
	rules: GuidelineScore[];
}

export interface ViolationResult {
	id: number;
	threshold: number;
	violations: CommentViolation[];
}

export const MIN_VIOLATION_THRESHOLD = 0.2;

const GUIDELINES = [
	'Be civil and address the argument.',
	'Make criticism substantive.',
	'Eschew flamebait.',
	'Do not use Hacker News for political or ideological battle.',
	'Do not tell another commenter they did not read the linked article, or ask whether they did.',
	'Do not accuse discussion participants of coordinated manipulation.',
	'Do not complain that a submission or comment is inappropriate; use the flag mechanism instead.',
	'Do not make a common tangential annoyance the substance of a comment.',
	'Do not discuss comment votes or scores.',
	'Avoid generic tangents and internet tropes.'
] as const;

export function parseViolationThreshold(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= MIN_VIOLATION_THRESHOLD && parsed <= 1
		? parsed
		: null;
}

export function parseViolationResult(value: unknown): ViolationResult | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	if (!Number.isInteger(candidate.id) || typeof candidate.threshold !== 'number') return null;
	if (!Array.isArray(candidate.violations)) return null;

	const violations: CommentViolation[] = [];
	for (const rawViolation of candidate.violations) {
		if (!rawViolation || typeof rawViolation !== 'object') continue;
		const violation = rawViolation as Record<string, unknown>;
		if (!Number.isInteger(violation.id) || !Array.isArray(violation.rules)) continue;

		const rules = violation.rules.flatMap((rawRule): GuidelineScore[] => {
			if (!rawRule || typeof rawRule !== 'object') return [];
			const rule = rawRule as Record<string, unknown>;
			return Number.isInteger(rule.rule) &&
				typeof rule.score === 'number' &&
				Number.isFinite(rule.score) &&
				rule.score >= 0 &&
				rule.score <= 1
				? [{ rule: rule.rule as number, score: rule.score }]
				: [];
		});

		if (rules.length > 0) violations.push({ id: violation.id as number, rules });
	}

	return {
		id: candidate.id as number,
		threshold: candidate.threshold,
		violations
	};
}

export function matchingGuidelines(
	rules: GuidelineScore[] | undefined,
	threshold: number | null
): GuidelineScore[] {
	if (threshold === null || !rules) return [];
	return rules.filter(({ score }) => score >= threshold).toSorted((a, b) => b.score - a.score);
}

export function guidelineTooltip(rules: GuidelineScore[]): string | undefined {
	if (rules.length === 0) return undefined;
	return [
		'Possible HN guideline violation',
		...rules.map(({ rule, score }) => {
			const description = GUIDELINES[rule - 1] ?? 'Unknown guideline.';
			return `Rule ${rule} (${score.toFixed(2)}): ${description}`;
		})
	].join('\n');
}
