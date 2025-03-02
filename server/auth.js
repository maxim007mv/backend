const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Секретный ключ для JWT (в реальном приложении должен быть в .env)
const JWT_SECRET = 'your-secret-key';

// База данных пользователей (в реальном приложении должна быть в настоящей БД)
const users = new Map();

// Middleware для проверки аутентификации
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Недействительный токен' });
    }
    req.user = user;
    next();
  });
};

// Функции для работы с аутентификацией
const authController = {
  // Регистрация
  async register(req, res) {
    try {
      const { username, email, password } = req.body;

      // Проверка существующего пользователя
      const existingUser = Array.from(users.values()).find(u => u.email === email);
      if (existingUser) {
        return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
      }

      // Хеширование пароля
      const hashedPassword = await bcrypt.hash(password, 10);

      // Создание нового пользователя
      const newUser = {
        id: Date.now().toString(),
        username,
        email,
        password: hashedPassword,
        joinDate: new Date().toISOString(),
        avatar: ''
      };

      // Сохранение пользователя
      users.set(newUser.id, newUser);

      // Создание токена
      const token = jwt.sign({ userId: newUser.id }, JWT_SECRET);

      // Отправка ответа
      res.json({
        token,
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          joinDate: newUser.joinDate,
          avatar: newUser.avatar
        }
      });
    } catch (error) {
      console.error('Ошибка при регистрации:', error);
      res.status(500).json({ message: 'Ошибка при регистрации пользователя' });
    }
  },

  // Вход
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Поиск пользователя
      const user = Array.from(users.values()).find(u => u.email === email);
      if (!user) {
        return res.status(401).json({ message: 'Неверный email или пароль' });
      }

      // Проверка пароля
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ message: 'Неверный email или пароль' });
      }

      // Создание токена
      const token = jwt.sign({ userId: user.id }, JWT_SECRET);

      // Отправка ответа
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          joinDate: user.joinDate,
          avatar: user.avatar
        }
      });
    } catch (error) {
      console.error('Ошибка при входе:', error);
      res.status(500).json({ message: 'Ошибка при входе в систему' });
    }
  },

  // Получение данных пользователя
  async getMe(req, res) {
    try {
      const user = users.get(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'Пользователь не найден' });
      }

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        joinDate: user.joinDate,
        avatar: user.avatar
      });
    } catch (error) {
      console.error('Ошибка при получении данных пользователя:', error);
      res.status(500).json({ message: 'Ошибка при получении данных пользователя' });
    }
  },

  // Обновление профиля
  async updateProfile(req, res) {
    try {
      const user = users.get(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'Пользователь не найден' });
      }

      const { username, email } = req.body;

      // Обновление данных
      user.username = username || user.username;
      user.email = email || user.email;

      // Сохранение обновленных данных
      users.set(user.id, user);

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        joinDate: user.joinDate,
        avatar: user.avatar
      });
    } catch (error) {
      console.error('Ошибка при обновлении профиля:', error);
      res.status(500).json({ message: 'Ошибка при обновлении профиля' });
    }
  }
};

module.exports = {
  authenticateToken,
  authController,
  users
}; 