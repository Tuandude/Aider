#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { registerVerify } from './commands/verify';
import { registerPropose } from './commands/propose';

// .env nằm ở gốc workspace (hai cấp trên entry point), giúp `propose` chạy nội bộ
// mà không cần export biến môi trường trước.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const program = new Command();

program
  .name('aider')
  .description('Aider - mỗi node trong sơ đồ kiến trúc phải ánh xạ tới một file có thật')
  .version('2.0.0');

program
  .command('init')
  .description('Thêm khối AIDER:START/END vào README.md của repo hiện tại')
  .action(() => {
    const gitDir = path.join(process.cwd(), '.git');
    if (!fs.existsSync(gitDir)) {
      console.error('Lỗi: không phải git repository.');
      process.exit(1);
    }

    const readmePath = path.join(process.cwd(), 'README.md');
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      if (content.includes('AIDER:START')) {
        console.log('README.md đã có khối AIDER.');
        return;
      }
      fs.writeFileSync(readmePath, `${content}\n\n<!-- AIDER:START -->\n\`\`\`mermaid\ngraph TD\n\`\`\`\n<!-- AIDER:END -->\n`, 'utf8');
    } else {
      fs.writeFileSync(
        readmePath,
        '# Project\n\n<!-- AIDER:START -->\n```mermaid\ngraph TD\n```\n<!-- AIDER:END -->\n',
        'utf8'
      );
    }
    console.log('Đã thêm khối AIDER vào README.md.');
  });

registerVerify(program);
registerPropose(program);

program.parse(process.argv);
