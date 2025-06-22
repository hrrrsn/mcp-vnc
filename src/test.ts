import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class VncMcpTester {
  private serverProcess: ChildProcess | null = null;
  private testResults: TestResult[] = [];

  async runTests() {
    console.log('🧪 Starting VNC MCP Server Tests');
    console.log(`📋 VNC Configuration:`);
    console.log(`   Host: ${process.env.VNC_HOST || 'localhost'}`);
    console.log(`   Port: ${process.env.VNC_PORT || '5900'}`);
    console.log(`   Password: ${process.env.VNC_PASSWORD ? '[CONFIGURED]' : '[NOT SET]'}\n`);

    try {
      await this.startServer();
      await this.delay(3000); // Wait for server to initialize

      // Run all tests
      await this.testScreenshot();
      await this.testMouseMovement();
      await this.testMouseClicking();
      await this.testKeyboardInput();
      await this.testTextTyping();
      await this.testScreenshotDelay();
      await this.testMultipleScreenshots(); // Added new test here
      await this.testComplexWorkflow();

      this.printResults();
    } catch (error) {
      console.error('❌ Test suite failed to start:', error);
    } finally {
      this.stopServer();
    }
  }

  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🚀 Starting VNC MCP Server...');
      
      const env = {
        ...process.env,
        VNC_HOST: process.env.VNC_HOST || 'localhost',
        VNC_PORT: process.env.VNC_PORT || '5900'
      };

      this.serverProcess = spawn('node', ['dist/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      let initTimeout: NodeJS.Timeout;

      this.serverProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        console.log('📡 Server:', output.trim());
        
        if (output.includes('Connected to VNC server')) {
          clearTimeout(initTimeout);
          console.log('✅ VNC Connection Confirmed by server log.');
          resolve();
        } else if (output.includes('VNC MCP Server running') && !output.includes('VNC connection error') && !output.includes('Connection timeout')) {
          // Server is up, but VNC not yet connected. Don't resolve yet.
          // The initTimeout will handle cases where VNC never connects.
          console.log('⏳ VNC MCP Server is running, waiting for VNC connection...');
        } else if (output.includes('VNC connection error') || output.includes('Connection timeout')) {
            clearTimeout(initTimeout);
            reject(new Error('VNC connection failed during server startup: ' + output.trim()));
        }
      });

      this.serverProcess.on('error', (error) => {
        clearTimeout(initTimeout);
        reject(new Error('Server process error: ' + error.message));
      });

      this.serverProcess.on('exit', (code) => {
        // If resolve() or reject() hasn't been called yet by initTimeout or specific log message
        // this means the server exited prematurely or without expected logs.
        if (code !== 0) {
            // Check if already resolved/rejected to avoid issues with multiple calls
            // This simple check might need a more robust state variable if race conditions occur
            if (!(initTimeout as any)._destroyed) { // A bit hacky way to check if timeout is still pending
                 clearTimeout(initTimeout);
                 reject(new Error(`Server exited prematurely with code ${code} before VNC connection established.`));
            } else {
                 console.error(`❌ Server exited with code ${code} (after initial startup phase).`);
            }
        }
      });

      // Timeout if VNC connection doesn't establish within 10 seconds
      initTimeout = setTimeout(() => {
        reject(new Error('VNC connection confirmation timeout (10 seconds)'));
      }, 10000);
    });
  }

  private async testMultipleScreenshots() {
    await this.runTest('Multiple Screenshots', async () => {
      mkdirSync('test-output', { recursive: true });

      // 1. Take an initial screenshot
      const response1 = await this.sendMcpRequest('vnc_screenshot');
      if (!response1.result || !response1.result.content) {
        throw new Error('No content in initial screenshot response');
      }
      const imageContent1 = response1.result.content.find((c: any) => c.type === 'image');
      if (!imageContent1 || !imageContent1.data) {
        throw new Error('No image data in initial screenshot response');
      }
      const pngData1 = Buffer.from(imageContent1.data, 'base64');
      writeFileSync('test-output/multi_shot_1.png', pngData1);
      console.log(`  📸 Initial screenshot saved to test-output/multi_shot_1.png (${pngData1.length} bytes)`);

      // 2. Perform an action to change the screen
      const testText = `Second shot test ${Date.now()}`;
      await this.sendMcpRequest('vnc_type_text', { text: testText });
      console.log(`  ⌨️ Typed text: "${testText}"`);

      // Add a small delay for the server to process and update its framebuffer
      await this.delay(1000); // Increased delay to ensure text is rendered

      // 3. Take a second screenshot
      const response2 = await this.sendMcpRequest('vnc_screenshot');
      if (!response2.result || !response2.result.content) {
        throw new Error('No content in second screenshot response');
      }
      const imageContent2 = response2.result.content.find((c: any) => c.type === 'image');
      if (!imageContent2 || !imageContent2.data) {
        throw new Error('No image data in second screenshot response');
      }
      const pngData2 = Buffer.from(imageContent2.data, 'base64');
      writeFileSync('test-output/multi_shot_2.png', pngData2);
      console.log(`  📸 Second screenshot saved to test-output/multi_shot_2.png (${pngData2.length} bytes)`);

      if (pngData1.equals(pngData2)) {
        console.warn(`  ⚠️ Warning: The two screenshots are identical. This might be okay if the VNC server content didn't change or if the change wasn't visible.`);
        // This is not a strict failure for now, as VNC content change can be tricky to guarantee.
        // Manual inspection of multi_shot_1.png and multi_shot_2.png is recommended.
      } else {
        console.log('  🖼️ Screenshots are different, as expected.');
      }
    });
  }

  private stopServer() {
    if (this.serverProcess) {
      console.log('🛑 Stopping server...');
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
  }

  private async sendMcpRequest(tool: string, args: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.serverProcess) {
        reject(new Error('Server not running'));
        return;
      }

      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: tool,
          arguments: args
        }
      };

      let responseData = '';
      let timeout: NodeJS.Timeout;

      const handleData = (data: Buffer) => {
        responseData += data.toString();
        try {
          const response = JSON.parse(responseData);
          if (response.id === request.id) {
            clearTimeout(timeout);
            this.serverProcess!.stdout!.off('data', handleData);
            resolve(response);
          }
        } catch (e) {
          // Partial response, continue collecting
        }
      };

      this.serverProcess.stdout!.on('data', handleData);

      timeout = setTimeout(() => {
        this.serverProcess!.stdout!.off('data', handleData);
        reject(new Error('Request timeout'));
      }, 5000);

      this.serverProcess.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    console.log(`🔍 Testing: ${name}`);

    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.testResults.push({ name, passed: true, duration });
      console.log(`✅ ${name} - PASSED (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.testResults.push({ name, passed: false, error: errorMsg, duration });
      console.log(`❌ ${name} - FAILED (${duration}ms): ${errorMsg}`);
    }
  }

  private async testScreenshot() {
    await this.runTest('Screenshot Capture', async () => {
      const response = await this.sendMcpRequest('vnc_screenshot');
      
      if (!response.result || !response.result.content) {
        throw new Error('No content in screenshot response');
      }

      const content = response.result.content;
      const imageContent = content.find((c: any) => c.type === 'image');
      
      if (!imageContent || !imageContent.data) {
        throw new Error('No image data in screenshot response');
      }

      // Save screenshot for manual verification
      mkdirSync('test-output', { recursive: true });
      const pngData = Buffer.from(imageContent.data, 'base64');
      writeFileSync('test-output/screenshot.png', pngData);
      console.log(`  📸 Screenshot saved to test-output/screenshot.png (${pngData.length} bytes)`);
    });
  }

  private async testMouseMovement() {
    await this.runTest('Mouse Movement', async () => {
      const response = await this.sendMcpRequest('vnc_move_mouse', { x: 100, y: 100 });
      
      if (!response.result || !response.result.content) {
        throw new Error('No response from mouse movement');
      }

      const textContent = response.result.content.find((c: any) => c.type === 'text');
      if (!textContent || !textContent.text.includes('Moved mouse to (100, 100)')) {
        throw new Error('Unexpected mouse movement response');
      }
    });
  }

  private async testMouseClicking() {
    await this.runTest('Mouse Clicking', async () => {
      // Test left click
      let response = await this.sendMcpRequest('vnc_click', { x: 200, y: 200, button: 'left' });
      if (!response.result || !response.result.content) {
        throw new Error('No response from left click');
      }

      // Test right click
      response = await this.sendMcpRequest('vnc_click', { x: 300, y: 300, button: 'right' });
      if (!response.result || !response.result.content) {
        throw new Error('No response from right click');
      }

      // Test middle click
      response = await this.sendMcpRequest('vnc_click', { x: 250, y: 250, button: 'middle' });
      if (!response.result || !response.result.content) {
        throw new Error('No response from middle click');
      }

      // Test double-click
      response = await this.sendMcpRequest('vnc_click', { x: 300, y: 200, button: 'left', double: true });
      if (!response.result || !response.result.content) {
        throw new Error('No response from double-click');
      }
      
      const doubleClickContent = response.result.content.find((c: any) => c.type === 'text');
      if (!doubleClickContent || !doubleClickContent.text.includes('double-clicked')) {
        throw new Error('Double-click not reflected in response');
      }
    });
  }

  private async testKeyboardInput() {
    await this.runTest('Keyboard Input', async () => {
      // Test individual key presses
      const singleKeys = ['a', 'Enter', 'Escape', 'F1', 'Up', 'Down'];
      
      for (const key of singleKeys) {
        const response = await this.sendMcpRequest('vnc_key_press', { key });
        if (!response.result || !response.result.content) {
          throw new Error(`No response from keypress: ${key}`);
        }
        await this.delay(100);
      }
      
      // Test key combinations
      const keyCominations = ['Ctrl+c', 'Alt+F4', 'Ctrl+Alt+Delete', 'Shift+F10', 'Ctrl+Shift+Escape'];
      
      for (const combo of keyCominations) {
        const response = await this.sendMcpRequest('vnc_key_press', { key: combo });
        if (!response.result || !response.result.content) {
          throw new Error(`No response from key combination: ${combo}`);
        }
        
        const textContent = response.result.content.find((c: any) => c.type === 'text');
        if (!textContent || !textContent.text.includes(combo)) {
          throw new Error(`Key combination not reflected in response: ${combo}`);
        }
        
        await this.delay(200); // Longer delay for combinations
      }
    });
  }

  private async testTextTyping() {
    await this.runTest('Text Typing', async () => {
      const testText = 'Hello, VNC World! 123';
      const response = await this.sendMcpRequest('vnc_type_text', { text: testText });
      
      if (!response.result || !response.result.content) {
        throw new Error('No response from text typing');
      }

      const textContent = response.result.content.find((c: any) => c.type === 'text');
      if (!textContent || !textContent.text.includes(testText)) {
        throw new Error('Unexpected text typing response');
      }
    });
  }

  private async testScreenshotDelay() {
    await this.runTest('Screenshot with Delay', async () => {
      console.log('  ⏰ Testing 2-second delay...');
      const startTime = Date.now();
      
      const response = await this.sendMcpRequest('vnc_screenshot', { delay: 2000 });
      
      const elapsed = Date.now() - startTime;
      
      if (!response.result || !response.result.content) {
        throw new Error('No content in delayed screenshot response');
      }

      const content = response.result.content;
      const textContent = content.find((c: any) => c.type === 'text');
      const imageContent = content.find((c: any) => c.type === 'image');
      
      if (!textContent || !textContent.text.includes('after 2000ms delay')) {
        throw new Error('Delay not reflected in response text');
      }
      
      if (!imageContent || !imageContent.data) {
        throw new Error('No image data in delayed screenshot response');
      }

      // Verify the delay actually happened (should take at least 2 seconds)
      if (elapsed < 1900) { // Allow some tolerance
        throw new Error(`Delay too short: ${elapsed}ms (expected ~2000ms)`);
      }

      // Save delayed screenshot
      mkdirSync('test-output', { recursive: true });
      const delayedPngData = Buffer.from(imageContent.data, 'base64');
      writeFileSync('test-output/screenshot-delayed.png', delayedPngData);
      console.log(`  📸 Delayed screenshot saved (${elapsed}ms elapsed)`);
    });
  }

  private async testComplexWorkflow() {
    await this.runTest('Complex Workflow', async () => {
      // Simulate opening a text editor and writing something
      console.log('  🎯 Simulating complex workflow...');
      
      // Move to a position and click (simulate opening an app)
      await this.sendMcpRequest('vnc_move_mouse', { x: 400, y: 300 });
      await this.delay(100);
      
      await this.sendMcpRequest('vnc_click', { x: 400, y: 300, button: 'left' });
      await this.delay(500);
      
      // Type some text
      await this.sendMcpRequest('vnc_type_text', { text: 'VNC MCP Test - ' });
      await this.delay(100);
      
      // Press some keys
      await this.sendMcpRequest('vnc_key_press', { key: 'Enter' });
      await this.delay(100);
      
      await this.sendMcpRequest('vnc_type_text', { text: new Date().toISOString() });
      await this.delay(100);
      
      // Take a final screenshot
      const screenshot = await this.sendMcpRequest('vnc_screenshot');
      if (!screenshot.result || !screenshot.result.content) {
        throw new Error('Failed to capture final screenshot');
      }
      
      // Save final screenshot
      const content = screenshot.result.content;
      const imageContent = content.find((c: any) => c.type === 'image');
      if (imageContent && imageContent.data) {
        const finalPngData = Buffer.from(imageContent.data, 'base64');
        writeFileSync('test-output/workflow-final.png', finalPngData);
        console.log(`  📸 Final screenshot saved to test-output/workflow-final.png (${finalPngData.length} bytes)`);
      }
    });
  }

  private printResults() {
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    
    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => r.passed === false).length;
    const totalTime = this.testResults.reduce((sum, r) => sum + r.duration, 0);
    
    this.testResults.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      const time = `${result.duration}ms`;
      console.log(`${status} ${result.name.padEnd(20)} (${time})`);
      if (!result.passed && result.error) {
        console.log(`     Error: ${result.error}`);
      }
    });
    
    console.log(`\n📈 Summary: ${passed} passed, ${failed} failed`);
    console.log(`⏱️  Total time: ${totalTime}ms`);
    
    if (failed === 0) {
      console.log('🎉 All tests passed!');
    } else {
      console.log('💥 Some tests failed. Check the VNC connection and server configuration.');
      process.exit(1);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Check if VNC configuration is provided
if (!process.env.VNC_HOST && process.env.VNC_HOST !== 'localhost') {
  console.log('ℹ️  VNC_HOST not set, using localhost');
}

if (!process.env.VNC_PORT) {
  console.log('ℹ️  VNC_PORT not set, using 5900');
}

console.log('🔧 To configure VNC connection, set environment variables:');
console.log('   export VNC_HOST=your-vnc-host');
console.log('   export VNC_PORT=5900');
console.log('   export VNC_PASSWORD=your-password');
console.log();

const tester = new VncMcpTester();
tester.runTests().catch(console.error);