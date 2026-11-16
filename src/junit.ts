import { escapeXml, firstLine, xmlCdata } from './format';
import type { ReportSummary } from './types';

export function historyKey(testName: string): string {
  return testName.split(' › ').join(' ');
}

/**
 * Generate standard JUnit XML for Azure DevOps Test Results publishing
 */
export function generateJUnitXml(summary: ReportSummary): string {
  const durationSec = (summary.totalDurationMs / 1000).toFixed(3);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="${escapeXml(summary.projectName)}" time="${durationSec}" tests="${summary.totalTests}" failures="${summary.totalFailed}" errors="0">\n`;

  for (const spec of summary.specs) {
    const specDurationSec = (spec.duration / 1000).toFixed(3);
    xml += `  <testsuite name="${escapeXml(spec.specName)}" file="${escapeXml(spec.specFile)}" tests="${spec.total}" failures="${spec.failures}" skipped="${spec.pending + spec.skipped}" time="${specDurationSec}" timestamp="${summary.timestamp}">\n`;

    for (const test of spec.tests) {
      const testDurationSec = (test.duration / 1000).toFixed(3);
      xml += `    <testcase name="${escapeXml(test.fullTitle)}" classname="${escapeXml(spec.specName)}" time="${testDurationSec}">\n`;
      if (test.tags?.length) {
        xml += `      <properties>${test.tags.map(tag => `<property name="tag" value="${escapeXml(tag)}"/>`).join('')}</properties>\n`;
      }

      if (test.state === 'failed') {
        const msg = firstLine(test.displayError) || 'Test failed';
        xml += `      <failure message="${escapeXml(msg)}" type="AssertionError">\n`;
        xml += escapeXml(test.displayError || msg);
        xml += `\n      </failure>\n`;
      } else if (test.state === 'pending' || test.state === 'skipped') {
        xml += `      <skipped message="Test was skipped or pending"/>\n`;
      }

      xml += `    </testcase>\n`;
    }

    xml += `  </testsuite>\n`;
  }

  xml += `</testsuites>\n`;
  return xml;
}

export function generateCarrierJUnit(testName: string, timestamp: string, text: string): string {
  const name = escapeXml(testName);
  return (
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites name="${name}" tests="1" failures="0" time="0">`,
      `  <testsuite name="${name}" timestamp="${escapeXml(timestamp.replace(/\.\d+Z$/, ''))}" tests="1" failures="0" errors="0" skipped="0" time="0">`,
      `    <testcase name="${name}" classname="${name}" time="0">`,
      `      <system-out>${xmlCdata(text)}</system-out>`,
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>'
    ].join('\n') + '\n'
  );
}
