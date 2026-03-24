const DAY_NAMES_KO: Record<string, number> = {
  '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6,
  '일요일': 0, '월요일': 1, '화요일': 2, '수요일': 3, '목요일': 4, '금요일': 5, '토요일': 6,
};

const DAY_NAMES_EN: Record<string, number> = {
  'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
  'thursday': 4, 'friday': 5, 'saturday': 6,
  'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6,
};

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function nextWeekday(ref: Date, targetDay: number): Date {
  const current = ref.getDay();
  let diff = targetDay - current;
  if (diff <= 0) diff += 7;
  return addDays(ref, diff);
}

function nextWeekWeekday(ref: Date, targetDay: number): Date {
  const diff = (7 - ref.getDay()) + targetDay;
  return addDays(ref, diff <= 7 ? diff + 7 : diff);
}

function endOfMonth(ref: Date): Date {
  return new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
}

function toISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function resolveDate(expression: string, referenceDate: string): string {
  const ref = new Date(referenceDate + 'T00:00:00');
  const expr = expression.trim();

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(expr)) return expr;

  // Korean relative dates
  if (expr === '오늘') return toISO(ref);
  if (expr === '내일') return toISO(addDays(ref, 1));
  if (expr === '모레') return toISO(addDays(ref, 2));
  if (expr === '글피') return toISO(addDays(ref, 3));
  if (expr === '어제') return toISO(addDays(ref, -1));

  // English relative dates
  if (expr.toLowerCase() === 'today') return toISO(ref);
  if (expr.toLowerCase() === 'tomorrow') return toISO(addDays(ref, 1));
  if (expr.toLowerCase() === 'yesterday') return toISO(addDays(ref, -1));

  // N일 후 / in N days
  const nDaysKo = expr.match(/(\d+)\s*일\s*후/);
  if (nDaysKo) return toISO(addDays(ref, parseInt(nDaysKo[1])));
  const nDaysEn = expr.match(/in\s+(\d+)\s+days?/i);
  if (nDaysEn) return toISO(addDays(ref, parseInt(nDaysEn[1])));

  // 다음주 X요일 / next X
  for (const [name, day] of Object.entries(DAY_NAMES_KO)) {
    if (expr.includes('다음주') && expr.includes(name)) {
      return toISO(nextWeekWeekday(ref, day));
    }
    if (expr.includes('이번주') && expr.includes(name)) {
      return toISO(nextWeekday(ref, day));
    }
    if (expr.includes('이번') && expr.includes(name)) {
      return toISO(nextWeekday(ref, day));
    }
  }
  for (const [name, day] of Object.entries(DAY_NAMES_EN)) {
    if (expr.toLowerCase().startsWith('next') && expr.toLowerCase().includes(name)) {
      return toISO(nextWeekWeekday(ref, day));
    }
    if (expr.toLowerCase().startsWith('this') && expr.toLowerCase().includes(name)) {
      return toISO(nextWeekday(ref, day));
    }
  }

  // 이번 달 말 / end of month
  if (expr.includes('이번 달 말') || expr.includes('이달 말') || expr.includes('월말')) {
    return toISO(endOfMonth(ref));
  }
  if (expr.toLowerCase().includes('end of month')) {
    return toISO(endOfMonth(ref));
  }

  // 다음달 초
  if (expr.includes('다음달 초') || expr.includes('다음 달 초')) {
    const nextMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    return toISO(nextMonth);
  }

  // N주 후 / in N weeks
  const nWeeksKo = expr.match(/(\d+)\s*주\s*후/);
  if (nWeeksKo) return toISO(addDays(ref, parseInt(nWeeksKo[1]) * 7));
  const nWeeksEn = expr.match(/in\s+(\d+)\s+weeks?/i);
  if (nWeeksEn) return toISO(addDays(ref, parseInt(nWeeksEn[1]) * 7));

  // Fallback: return the expression as-is (may be an absolute date in another format)
  return expr;
}
