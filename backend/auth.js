const jwt = require('jsonwebtoken');

// Временное хранилище пользователей (в реальном приложении используйте базу данных)
const users = new Map();

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Недействительный токен' });
    }
    req.user = user;
    next();
  });
};

const authController = {
  register: async (req, res) => {
    try {
      const { username, email, password } = req.body;

      // Проверяем, существует ли пользователь
      for (const [_, user] of users.entries()) {
        if (user.email === email) {
          return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
        }
        if (user.username === username) {
          return res.status(400).json({ message: 'Пользователь с таким именем уже существует' });
        }
      }

      // Создаем нового пользователя
      const userId = Date.now().toString();
      const user = {
        id: userId,
        username,
        email,
        password, // В реальном приложении пароль должен быть захеширован
        joinDate: new Date().toISOString(),
        avatar: null
      };

      users.set(userId, user);

      // Создаем JWT токен
      const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '24h' });

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
      console.error('Error in register:', error);
      res.status(500).json({ message: 'Ошибка при регистрации' });
    }
  },

  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      // Ищем пользователя
      let foundUser = null;
      for (const [_, user] of users.entries()) {
        if (user.email === email && user.password === password) {
          foundUser = user;
          break;
        }
      }

      if (!foundUser) {
        return res.status(401).json({ message: 'Неверный email или пароль' });
      }

      // Создаем JWT токен
      const token = jwt.sign({ id: foundUser.id }, process.env.JWT_SECRET, { expiresIn: '24h' });

      res.json({
        token,
        user: {
          id: foundUser.id,
          username: foundUser.username,
          email: foundUser.email,
          joinDate: foundUser.joinDate,
          avatar: foundUser.avatar
        }
      });
    } catch (error) {
      console.error('Error in login:', error);
      res.status(500).json({ message: 'Ошибка при входе' });
    }
  },

  getMe: async (req, res) => {
    try {
      const user = users.get(req.user.id);
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
      console.error('Error in getMe:', error);
      res.status(500).json({ message: 'Ошибка при получении данных пользователя' });
    }
  },

  updateProfile: async (req, res) => {
    try {
      const user = users.get(req.user.id);
      if (!user) {
        return res.status(404).json({ message: 'Пользователь не найден' });
      }

      const updates = req.body;
      
      // Проверяем уникальность username и email если они меняются
      if (updates.username && updates.username !== user.username) {
        for (const [_, otherUser] of users.entries()) {
          if (otherUser.username === updates.username) {
            return res.status(400).json({ message: 'Пользователь с таким именем уже существует' });
          }
        }
      }

      if (updates.email && updates.email !== user.email) {
        for (const [_, otherUser] of users.entries()) {
          if (otherUser.email === updates.email) {
            return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
          }
        }
      }

      // Обновляем данные пользователя
      Object.assign(user, updates);

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        joinDate: user.joinDate,
        avatar: user.avatar
      });
    } catch (error) {
      console.error('Error in updateProfile:', error);
      res.status(500).json({ message: 'Ошибка при обновлении профиля' });
    }
  }
};

module.exports = { authenticateToken, authController }; 