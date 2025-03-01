const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const { authenticateToken, authController } = require('./auth');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3005;

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Создаем папку для загрузок, если её нет
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Делаем папку uploads доступной статически
app.use('/uploads', express.static('uploads'));

// Настройка CORS
app.use(cors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000'],
  methods: ['GET', 'POST', 'DELETE', 'PUT'],
  credentials: true
}));

app.use(express.json());

// Инициализация OpenAI с конфигурацией для Qwen
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
});

// Middleware для логирования запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Хранилище пользователей и их маршрутов (временное решение)
const users = new Map();
const routes = new Map();
const reviews = new Map();

// Функция для получения координат места через API Яндекс.Геокодер
async function getCoordinates(placeName) {
  try {
    const response = await axios.get(`https://geocode-maps.yandex.ru/1.x/`, {
      params: {
        apikey: process.env.YANDEX_API_KEY,
        format: 'json',
        geocode: `Москва, ${placeName}`,
      }
    });

    const features = response.data.response.GeoObjectCollection.featureMember;
    if (features.length > 0) {
      const coordinates = features[0].GeoObject.Point.pos.split(' ').map(Number).reverse();
      return coordinates;
    }
    return null;
  } catch (error) {
    console.error('Ошибка геокодирования:', error);
    return null;
  }
}

// Генерация маршрута
app.post('/api/generate-route', async (req, res) => {
  try {
    const { 
      categories, 
      duration, 
      pace,
      transportType,
      timeOfDay, 
      accessibility, 
      preferences,
      userId
    } = req.body;

    console.log('Получен запрос на генерацию маршрута:', req.body);

    const completion = await openai.chat.completions.create({
      model: "qwen-max",
      messages: [
        { 
          role: "system", 
          content: `Ты - опытный планировщик маршрутов по Москве. Создавай подробные, интересные маршруты.
          Важно: указывай ТОЧНЫЕ названия мест и достопримечательностей, которые существуют в Москве.
          
          Структура ответа должна быть такой:
          
          🎯 КРАТКИЙ ОБЗОР МАРШРУТА
          [Очень краткое описание маршрута в 2-3 предложения]
          
          📍 ТОЧКИ МАРШРУТА:
          
          1. [Точное название места] 🏛️
             ⏱️ Время: [длительность пребывания]
             📝 Описание: [краткое описание места]
             🎯 Активности:
             - [активность 1]
             - [активность 2]
             - [активность 3]
             💡 Советы:
             - [совет 1]
             - [совет 2]
             🚶 Переход: [как добраться до следующей точки, сколько времени займет, с детальным описанием маршрута]`
        },
        { 
          role: "user", 
          content: `Создай детальный маршрут по Москве со следующими параметрами:
            - Категории: ${categories.join(', ')}
            - Длительность: ${duration} часов
            - Темп: ${pace}
            - Способ передвижения: ${transportType}
            - Время суток: ${timeOfDay}
            - Доступность: ${accessibility}
            - Дополнительные пожелания: ${preferences}`
        }
      ],
      temperature: 0.7,
      max_tokens: 3000
    });

    if (!completion.choices || !completion.choices[0]) {
      throw new Error('Некорректный ответ от API');
    }

    const routeDescription = completion.choices[0]?.message?.content;
    const routeId = Date.now().toString();

    // Парсим ответ AI и создаем структурированный маршрут
    const sections = routeDescription.split('\n\n');
    let overview = '';
    const points = [];
    let currentPoint = null;

    for (const section of sections) {
      if (section.startsWith('🎯 КРАТКИЙ ОБЗОР')) {
        overview = section.replace('🎯 КРАТКИЙ ОБЗОР МАРШРУТА', '').trim();
      } else if (section.match(/^\d+\./)) {
        if (currentPoint) {
          const coordinates = await getCoordinates(currentPoint.name);
          if (coordinates) {
            currentPoint.coordinates = coordinates;
          }
          points.push(currentPoint);
        }
        
        const lines = section.split('\n');
        const name = lines[0].replace(/^\d+\.\s*/, '').trim();
        
        currentPoint = {
          id: points.length + 1,
          name: name,
          duration: '',
          description: '',
          activities: [],
          tips: [],
          transition: ''
        };

        for (const line of lines.slice(1)) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('⏱️')) {
            currentPoint.duration = trimmedLine.replace('⏱️ Время:', '').trim();
          } else if (trimmedLine.startsWith('📝')) {
            currentPoint.description = trimmedLine.replace('📝 Описание:', '').trim();
          } else if (trimmedLine.startsWith('-') && currentPoint.activities.length < 3) {
            currentPoint.activities.push(trimmedLine.replace('-', '').trim());
          } else if (trimmedLine.startsWith('💡')) {
            currentPoint.tips.push(trimmedLine.replace('💡', '').trim());
          } else if (trimmedLine.startsWith('🚶')) {
            currentPoint.transition = trimmedLine.replace('🚶 Переход:', '').trim();
          }
        }
      }
    }

    if (currentPoint) {
      const coordinates = await getCoordinates(currentPoint.name);
      if (coordinates) {
        currentPoint.coordinates = coordinates;
      }
      points.push(currentPoint);
    }
    
    // Создаем Яндекс.Карты ссылку для маршрута
    const mapPoints = points
      .filter(point => point.coordinates)
      .map(point => point.coordinates.join(','))
      .join('~');
    
    const yandexMapsUrl = `https://yandex.ru/maps/?rtext=${mapPoints}&rtt=pd`;
    
    const routeData = {
      routeId: routeId,
      name: `${duration}-часовой ${categories.join(' и ')} маршрут`,
      description: overview,
      duration: duration,
      pace: pace,
      timeOfDay: timeOfDay,
      points: points,
      yandexMapsUrl: yandexMapsUrl,
      createdAt: new Date().toISOString()
    };

    // Сохраняем маршрут в хранилище
    routes.set(routeId, routeData);

    // Если есть userId, сохраняем маршрут в профиль пользователя
    if (userId) {
      if (!users.has(userId)) {
        users.set(userId, { routes: new Set() });
      }
      users.get(userId).routes.add(routeId);
    }

    res.json(routeData);
  } catch (error) {
    console.error('Ошибка при обработке запроса:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка при генерации маршрута',
      details: error.message
    });
  }
});

// Получение маршрута по ID
app.get('/api/route/:id', (req, res) => {
  const routeId = req.params.id;
  const route = routes.get(routeId);
  
  if (!route) {
    return res.status(404).json({
      success: false,
      error: 'Маршрут не найден'
    });
  }
  
  res.json(route);
});

// Сохранение маршрута в профиль пользователя
app.post('/api/save-route', (req, res) => {
  const { userId, routeId } = req.body;
  
  if (!users.has(userId)) {
    users.set(userId, { routes: new Set() });
  }
  
  const userProfile = users.get(userId);
  userProfile.routes.add(routeId);
  
  res.json({ success: true });
});

// Получение маршрутов пользователя
app.get('/api/user-routes/:userId', (req, res) => {
  const userId = req.params.userId;
  const userProfile = users.get(userId);
  
  if (!userProfile) {
    return res.json({ routes: [] });
  }
  
  const userRoutes = Array.from(userProfile.routes)
    .map(routeId => {
      const route = routes.get(routeId);
      return route ? { ...route, id: routeId } : null;
    })
    .filter(route => route !== null);
  
  res.json({ routes: userRoutes });
});

// Удаление маршрута
app.delete('/api/routes/:routeId', (req, res) => {
  const routeId = req.params.routeId;
  routes.delete(routeId);
  
  for (const [userId, userProfile] of users.entries()) {
    userProfile.routes.delete(routeId);
  }
  
  res.json({ success: true });
});

// Загрузка аватара
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был загружен' });
    }
    
    const avatarUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ success: true, avatarUrl });
  } catch (error) {
    console.error('Ошибка при загрузке файла:', error);
    res.status(500).json({ error: 'Ошибка при загрузке файла' });
  }
});

// Маршруты аутентификации
app.post('/api/auth/register', authController.register);
app.post('/api/auth/login', authController.login);
app.get('/api/auth/me', authenticateToken, authController.getMe);
app.put('/api/auth/update-profile', authenticateToken, authController.updateProfile);

// Добавление отзыва к маршруту
app.post('/api/reviews', async (req, res) => {
  try {
    const { userId, routeId, likedAspects, dislikedAspects, comment, rating } = req.body;

    if (!users.has(userId)) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    if (!routes.has(routeId)) {
      return res.status(404).json({ message: 'Маршрут не найден' });
    }

    const reviewId = Date.now().toString();
    const review = {
      id: reviewId,
      userId,
      routeId,
      likedAspects,
      dislikedAspects,
      comment,
      rating,
      createdAt: new Date().toISOString()
    };

    if (!reviews.has(routeId)) {
      reviews.set(routeId, new Map());
    }
    reviews.get(routeId).set(userId, review);

    const route = routes.get(routeId);
    if (!route.reviews) {
      route.reviews = [];
    }
    route.reviews.push(reviewId);

    const routeReviews = Array.from(reviews.get(routeId).values());
    route.averageRating = routeReviews.reduce((acc, rev) => acc + rev.rating, 0) / routeReviews.length;

    res.json({ success: true, review });
  } catch (error) {
    console.error('Error saving review:', error);
    res.status(500).json({ message: 'Ошибка при сохранении отзыва' });
  }
});

// Получение отзывов пользователя
app.get('/api/user-reviews/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const userReviews = [];

    for (const [routeId, routeReviews] of reviews.entries()) {
      const review = routeReviews.get(userId);
      if (review) {
        const route = routes.get(routeId);
        userReviews.push({
          ...review,
          routeName: route.name,
          routeDuration: route.duration,
          routePace: route.pace
        });
      }
    }

    res.json({ reviews: userReviews });
  } catch (error) {
    console.error('Error fetching user reviews:', error);
    res.status(500).json({ message: 'Ошибка при получении отзывов' });
  }
});

// Получение отзывов маршрута
app.get('/api/route-reviews/:routeId', (req, res) => {
  try {
    const routeId = req.params.routeId;
    const routeReviews = reviews.get(routeId);

    if (!routeReviews) {
      return res.json({ reviews: [] });
    }

    const reviewsList = Array.from(routeReviews.values()).map(review => {
      const user = users.get(review.userId);
      return {
        ...review,
        username: user.username,
        userAvatar: user.avatar
      };
    });

    res.json({ reviews: reviewsList });
  } catch (error) {
    console.error('Error fetching route reviews:', error);
    res.status(500).json({ message: 'Ошибка при получении отзывов' });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Необработанная ошибка:', err);
  res.status(500).json({
    success: false,
    error: 'Внутренняя ошибка сервера',
    details: err.message
  });
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
}); 