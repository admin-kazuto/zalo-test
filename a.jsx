// File: src/App.jsx
// PHIÊN BẢN SỬA LỖI - SỬ DỤNG MỘT KẾT NỐI SOCKET DUY NHẤT

import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SOCKET_URL = 'http://localhost:3001';
const SERVER_URL = 'http://localhost:3001';

function App() {
  // BƯỚC 1: Đưa socket ra ngoài state để có thể truy cập từ mọi nơi
  const [socket, setSocket] = useState(null); 
  
  const [isConnected, setIsConnected] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [logs, setLogs] = useState([]);

  const addLog = (message) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${message}`, ...prev]);
  };

  useEffect(() => {
    // BƯỚC 2: Khởi tạo socket và lưu vào state
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket); // Lưu instance của socket

    newSocket.on('connect', () => {
      setIsConnected(true);
      addLog(` Connected to server! Socket ID: ${newSocket.id}`);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      setQrCodeUrl(null);
      addLog(' Disconnected from server.');
    });

    newSocket.on('qr_code_ready', ({ tempId }) => {
      addLog(` SUCCESS! Received 'qr_code_ready' event!`);
      addLog(`Temp ID: ${tempId}`);
      const imageUrl = `${SERVER_URL}/api/qr-code/${tempId}.png`;
      addLog(`Constructed QR Image URL: ${imageUrl}`);
      setQrCodeUrl(imageUrl);
    });

    // Cleanup khi component bị hủy
    return () => {
      newSocket.disconnect();
    };
  }, []);

  // BƯỚC 3: Sửa lại hàm handleRequestLogin
  const handleRequestLogin = () => {
    // DÙNG SOCKET ĐÃ ĐƯỢC LƯU TRONG STATE, KHÔNG TẠO SOCKET MỚI
    if (socket && socket.connected) { 
      addLog(" Sending 'request_new_login' event to server...");
      setQrCodeUrl(null);
      socket.emit('request_new_login'); // Dùng đúng socket đang kết nối
    } else {
      addLog("Cannot send, not connected.");
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Zalo QR Code Login</h1>
        <div className="status">
          Status: 
          <span className={isConnected ? 'connected' : 'disconnected'}>
            {isConnected ? ' Connected' : ' Disconnected'}
          </span>
        </div>
        
        <button onClick={handleRequestLogin} disabled={!isConnected}>
          Request New QR Code
        </button>

        <div className="qr-container">
          {qrCodeUrl ? (
            <>
              <p>Scan the QR code below to login:</p>
              <img src={qrCodeUrl} alt="Zalo QR Code" />
            </>
          ) : (
            <p>Click the button to get a new QR code.</p>
          )}
        </div>

        <div className="log-container">
          <h2>Logs</h2>
          <div className="logs">
            {logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
          </div>
        </div>
      </header>
    </div>
  );
}

export default App;