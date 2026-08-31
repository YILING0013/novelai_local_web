'use client'

import { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, Gamepad2, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';

// 粒子效果组件，用于背景和食物爆炸
const Particle = ({ x, y, color, size, isFading }) => (
  <div
    className="absolute rounded-full"
    style={{
      left: x,
      top: y,
      width: size,
      height: size,
      backgroundColor: color,
      opacity: isFading ? 0 : 1,
      transition: 'opacity 1s ease-out, transform 1s ease-out',
      transform: isFading ? `translate(${Math.random() * 40 - 20}px, ${Math.random() * 40 - 20}px)` : 'translate(0,0)',
    }}
  />
);


export default function NotFound() {
  const { t } = useI18n();
  const translationRef = useRef(t);

  useEffect(() => {
    translationRef.current = t;
  }, [t]);
  // 维护预计结束时间
  const [maintenanceEndTime] = useState(() => {
    const time = new Date();
    time.setHours(time.getHours() + 8);
    return time;
  });

  const [timeLeft, setTimeLeft] = useState({
    hours: 0,
    minutes: 0,
    seconds: 0
  });

  // 游戏状态
  const [gameActive, setGameActive] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [foodParticles, setFoodParticles] = useState([]);

  // 计算剩余维护时间
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const difference = maintenanceEndTime - now;

      if (difference <= 0) {
        clearInterval(timer);
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const hours = Math.floor(difference / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft({ hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(timer);
  }, [maintenanceEndTime]);
  
  // 从localStorage加载最高分
  useEffect(() => {
    const savedHighScore = localStorage.getItem('snakeHighScore');
    if (savedHighScore) {
      setHighScore(parseInt(savedHighScore, 10));
    }
  }, []);

  // 贪吃蛇游戏核心逻辑
  useEffect(() => {
    if (!gameActive || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const GRID_SIZE = 20;
    const GAME_SPEED = 120; // 毫秒

    const setCanvasSize = () => {
      const container = canvas.parentElement;
      if(container) {
          canvas.width = Math.floor(container.clientWidth / GRID_SIZE) * GRID_SIZE;
          canvas.height = Math.floor(container.clientHeight / GRID_SIZE) * GRID_SIZE;
      }
    };

    setCanvasSize();

    // 初始化游戏状态
    let snake = [{
      x: Math.floor(canvas.width / GRID_SIZE / 2) * GRID_SIZE,
      y: Math.floor(canvas.height / GRID_SIZE / 2) * GRID_SIZE
    }];
    let direction = { x: GRID_SIZE, y: 0 };
    let nextDirection = { ...direction };
    let food = null;
    let gameOver = false;
    let currentScore = 0;

    const generateFood = () => {
      const possiblePositions = [];
      for (let x = 0; x < canvas.width; x += GRID_SIZE) {
        for (let y = 0; y < canvas.height; y += GRID_SIZE) {
          if (!snake.some(segment => segment.x === x && segment.y === y)) {
            possiblePositions.push({ x, y });
          }
        }
      }
      if (possiblePositions.length > 0) {
        return possiblePositions[Math.floor(Math.random() * possiblePositions.length)];
      }
      return { x: 0, y: 0 };
    };
    
    food = generateFood();

    const changeDirection = (newDir) => {
        // 防止蛇头直接反向移动
        const isOpposite = (
            (newDir.x !== 0 && newDir.x === -direction.x) ||
            (newDir.y !== 0 && newDir.y === -direction.y)
        );
        if (!isOpposite) {
            nextDirection = newDir;
        }
    };
    
    // 处理键盘输入
    const handleKeyDown = (e) => {
      if (gameOver) return;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
          changeDirection({ x: 0, y: -GRID_SIZE });
          break;
        case 'ArrowDown':
        case 's':
          changeDirection({ x: 0, y: GRID_SIZE });
          break;
        case 'ArrowLeft':
        case 'a':
          changeDirection({ x: -GRID_SIZE, y: 0 });
          break;
        case 'ArrowRight':
        case 'd':
          changeDirection({ x: GRID_SIZE, y: 0 });
          break;
      }
    };

    // 处理鼠标/触摸点击
    const handleClick = (e) => {
        if (gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const clickX = e.type.includes('touch') ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
        const clickY = e.type.includes('touch') ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

        const headX = snake[0].x + GRID_SIZE / 2;
        const headY = snake[0].y + GRID_SIZE / 2;
        const dx = clickX - headX;
        const dy = clickY - headY;

        if (Math.abs(dx) > Math.abs(dy)) {
            changeDirection({ x: (dx > 0 ? 1 : -1) * GRID_SIZE, y: 0 });
        } else {
            changeDirection({ x: 0, y: (dy > 0 ? 1 : -1) * GRID_SIZE });
        }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('touchstart', handleClick);

    const triggerFoodParticles = (x, y) => {
      const newParticles = [];
      for (let i = 0; i < 20; i++) {
        newParticles.push({
          id: Math.random(),
          x: x + GRID_SIZE / 2,
          y: y + GRID_SIZE / 2,
          color: '#f472b6', // fuchsia-400
          size: Math.random() * 3 + 1,
          isFading: false,
        });
      }
      setFoodParticles(newParticles);
      setTimeout(() => {
        setFoodParticles(prev => prev.map(p => ({ ...p, isFading: true })));
      }, 10);
       setTimeout(() => {
        setFoodParticles([]);
      }, 1010);
    };

    const gameLoop = () => {
      if (gameOver) {
          // 游戏结束画面
          ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.font = `bold ${canvas.width / 10}px 'Inter', sans-serif`;
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(translationRef.current('tools.notFound.gameOver'), canvas.width / 2, canvas.height / 2 - 20);
          
          ctx.font = `normal ${canvas.width / 25}px 'Inter', sans-serif`;
          ctx.fillText(translationRef.current('tools.notFound.restartHint'), canvas.width / 2, canvas.height/2 + 30);

          return;
      }

      // 清除画布
      ctx.fillStyle = 'rgba(15, 23, 42, 1)'; // slate-900
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 绘制网格背景
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)'; // slate-700
      for (let x = 0; x <= canvas.width; x += GRID_SIZE) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += GRID_SIZE) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
      }
      
      direction = { ...nextDirection };
      const head = { ...snake[0] };
      head.x += direction.x;
      head.y += direction.y;
      
      const hitWall = head.x < 0 || head.x >= canvas.width || head.y < 0 || head.y >= canvas.height;
      const hitSelf = snake.slice(1).some(segment => segment.x === head.x && segment.y === head.y);

      if (hitWall || hitSelf) {
        gameOver = true;
        setIsGameOver(true);
        if (currentScore > highScore) {
          setHighScore(currentScore);
          localStorage.setItem('snakeHighScore', currentScore.toString());
        }
        return;
      }

      snake.unshift(head);

      if (head.x === food.x && head.y === food.y) {
        triggerFoodParticles(food.x, food.y);
        food = generateFood();
        currentScore += 10;
        setScore(currentScore);
      } else {
        snake.pop();
      }

      // 绘制食物 (带脉冲效果)
      const pulse = Math.abs(Math.sin(Date.now() / 200)) * (GRID_SIZE / 4);
      ctx.fillStyle = '#f472b6'; // fuchsia-400
      ctx.shadowColor = '#f472b6';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(food.x + GRID_SIZE / 2, food.y + GRID_SIZE / 2, GRID_SIZE / 2.5 + pulse, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 绘制蛇
      snake.forEach((segment, index) => {
        const isHead = index === 0;
        const color = isHead ? '#22d3ee' : '#0e7490'; // cyan-400, cyan-700
        ctx.fillStyle = color;
        if (isHead) {
            ctx.shadowColor = '#67e8f9'; // cyan-300
            ctx.shadowBlur = 20;
        }
        ctx.fillRect(segment.x, segment.y, GRID_SIZE, GRID_SIZE);
        if(isHead) ctx.shadowBlur = 0;
      });
    };

    const gameInterval = setInterval(gameLoop, GAME_SPEED);
    
    const handleResize = () => setCanvasSize();
    window.addEventListener('resize', handleResize);

    gameRef.current = {
      interval: gameInterval,
      cleanup: () => {
        clearInterval(gameInterval);
        window.removeEventListener('keydown', handleKeyDown);
        canvas.removeEventListener('click', handleClick);
        canvas.removeEventListener('touchstart', handleClick);
        window.removeEventListener('resize', handleResize);
      }
    };

    return () => {
      if (gameRef.current) {
        gameRef.current.cleanup();
      }
    };
  }, [gameActive, highScore]);

  const startGame = () => {
    setScore(0);
    setIsGameOver(false);
    setGameActive(true);
  };
  
  const handleRestart = () => {
      if(isGameOver) {
          startGame();
      }
  };


  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-200 font-sans p-4 relative overflow-hidden">
        {/* 背景装饰：网格 */}
        <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:3rem_3rem]"></div>
        {/* 背景装饰：辉光 */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse-slow -z-10"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-3xl animate-pulse-slow animation-delay-4000 -z-10"></div>
        
      <div className="w-full max-w-lg bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl shadow-2xl shadow-black/30 p-6 sm:p-8 relative z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>
        
        <div className="text-center">
            <h1 className="text-7xl sm:text-8xl font-bold text-transparent bg-clip-text bg-gradient-to-tr from-slate-300 to-slate-500 animate-fade-in-down">404</h1>
            <p className="text-xl sm:text-2xl mt-2 text-slate-400 animate-fade-in-down" style={{animationDelay: '0.2s'}}>{t('tools.notFound.status')}</p>
            <div className="flex items-center justify-center gap-4 mt-6 mb-8 animate-fade-in-down" style={{animationDelay: '0.4s'}}>
                <WifiOff className="text-fuchsia-500" size={20}/>
                <p className="text-slate-400">{t('tools.notFound.description')}</p>
                <Wifi className="text-cyan-500" size={20}/>
            </div>
        </div>
        
        {/* 维护时间倒计时 */}
        <div className="bg-slate-900/50 rounded-lg p-4 mb-6 animate-fade-in" style={{animationDelay: '0.6s'}}>
          <div className="flex justify-center space-x-4 sm:space-x-6">
            <div className="flex flex-col items-center w-20 h-20 justify-center bg-slate-800/50 rounded-lg border border-slate-700">
              <span className="text-3xl font-semibold text-cyan-400 tracking-widest">{String(timeLeft.hours).padStart(2, '0')}</span>
              <span className="text-xs text-slate-500 mt-1">{t('tools.notFound.hours')}</span>
            </div>
            <div className="flex flex-col items-center w-20 h-20 justify-center bg-slate-800/50 rounded-lg border border-slate-700">
              <span className="text-3xl font-semibold text-cyan-400 tracking-widest">{String(timeLeft.minutes).padStart(2, '0')}</span>
              <span className="text-xs text-slate-500 mt-1">{t('tools.notFound.minutes')}</span>
            </div>
            <div className="flex flex-col items-center w-20 h-20 justify-center bg-slate-800/50 rounded-lg border border-slate-700">
              <span className="text-3xl font-semibold text-cyan-400 tracking-widest">{String(timeLeft.seconds).padStart(2, '0')}</span>
              <span className="text-xs text-slate-500 mt-1">{t('tools.notFound.seconds')}</span>
            </div>
          </div>
        </div>
        
        {/* 贪吃蛇游戏 */}
        <div className="border border-slate-700 bg-slate-900/50 rounded-lg p-4 animate-fade-in" style={{animationDelay: '0.8s'}}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium text-slate-300 flex items-center gap-2">
                <Gamepad2 size={20} className="text-cyan-400"/>
                {t('tools.notFound.challenge')}
            </h2>
            <div className="text-right">
                <div className="text-sm">
                    <span className="text-slate-400">{t('tools.notFound.score')} </span>
                    <span className="font-medium text-cyan-400 w-8 inline-block">{score}</span>
                </div>
                <div className="text-sm">
                    <span className="text-slate-400">{t('tools.notFound.highScore')} </span>
                    <span className="font-medium text-fuchsia-400 w-8 inline-block">{highScore}</span>
                </div>
            </div>
          </div>
          
          <div className="relative bg-slate-900 rounded overflow-hidden aspect-video" onClick={handleRestart} onKeyDown={handleRestart} tabIndex={0} aria-label={t('tools.notFound.gameArea')}>
            {foodParticles.map(p => (
              <Particle key={p.id} {...p} />
            ))}
            {(!gameActive || isGameOver) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 z-20">
                <p className="text-slate-400 mb-4 text-center px-4">
                  {t('tools.notFound.controls')}
                </p>
                <button 
                  onClick={startGame} 
                  className="px-6 py-2 bg-cyan-500/20 border border-cyan-500 text-cyan-300 rounded-md transition-all hover:bg-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/20"
                >
                  {isGameOver ? t('tools.notFound.restart') : t('tools.notFound.start')}
                </button>
              </div>
            )}
            <canvas 
              ref={canvasRef} 
              className="w-full h-full absolute top-0 left-0 z-10"
              style={{ imageRendering: 'pixelated' }}
            ></canvas>
          </div>
        </div>
        
        <div className="text-center mt-8 animate-fade-in" style={{animationDelay: '1s'}}>
          <Link href="/" className="group inline-flex items-center px-6 py-2 text-slate-400 hover:text-cyan-400 transition-colors">
            {t('tools.notFound.backHome')}
            <ArrowRight size={16} className="ml-2 transform transition-transform group-hover:translate-x-1"/>
          </Link>
        </div>
      </div>
    </div>
  );
}
