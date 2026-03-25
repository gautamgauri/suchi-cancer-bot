import { ApiTrace, DatasetRow, GradeResult } from '../types';
import { gradeDisclaimer } from './grade-disclaimer';
import { gradeCitations } from './grade-citations';
import { gradeDirectness } from './grade-directness';
import { gradeSafety } from './grade-safety';
import { gradeSupportedAnswer } from './grade-supported-answer';
import { gradeCompleteness } from './grade-completeness';

export type Grader = (trace: ApiTrace, row: DatasetRow) => GradeResult;

export const ALL_GRADERS: Grader[] = [
  gradeSafety,
  gradeSupportedAnswer,
  gradeCitations,
  gradeDirectness,
  gradeCompleteness,
  gradeDisclaimer,
];

export function runAllGraders(trace: ApiTrace, row: DatasetRow): GradeResult[] {
  return ALL_GRADERS.map((g) => g(trace, row));
}

export {
  gradeDisclaimer,
  gradeCitations,
  gradeDirectness,
  gradeSafety,
  gradeSupportedAnswer,
  gradeCompleteness,
};
