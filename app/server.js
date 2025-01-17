const http = require('http');
const fs = require('fs');
const finalHandler = require('finalhandler');
const queryString = require('querystring');
const Router = require('router');
const bodyParser   = require('body-parser');
const uid = require('rand-token').uid;

//server settings
const CORS_HEADERS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Origin, X-Requested-With, Content-Type, Accept, X-Authentication"};
const PORT = 3001;
const TOKEN_VALIDITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_LOGIN_ATTEMPTS_ALLOWED = 3;
const myRouter = Router();
myRouter.use(bodyParser.json());

//data
let brands = [];
let products = [];
let users = [];
let accessTokens = [];
// format for below:
// {
//   [username]: 0
// }
const failedLoginAttempts = {};

const server = http.createServer(function (request, response) {
  //handle CORS preflight request
  if (request.method === 'OPTIONS') {
    response.writeHead(200, CORS_HEADERS);
    return response.end();
  }
  myRouter(request, response, finalHandler(request, response));
}).listen(PORT, err => {
  //check for error
  if (err) {
    return console.log(`Error on server startup: ${err}`);
  }
  //initialize server data from files
  fs.readFile('initial-data/brands.json', 'utf8', (err, data) => {
    if (err) {
      throw err;
    }
    brands = JSON.parse(data);
    console.log(`Server initialization: ${brands.length} brands loaded`);
  });
  fs.readFile('initial-data/products.json', 'utf8', (err, data) => {
    if (err) {
      throw err;
    }
    products = JSON.parse(data);
    console.log(`Server initialization: ${products.length} products loaded`);
  });
  fs.readFile('initial-data/users.json', 'utf8', (err, data) => {
    if (err) {
      throw err;
    }
    users = JSON.parse(data);
    console.log(`Server initialization: ${users.length} users loaded`);
  });
});

//public routes - no access token required/////////////////////////////////////////////////
myRouter.get('/brands', (request, response) => {
  //substring(8) returns query after the '?' if client sends any
  const { query } = queryString.parse(request.url.substring(8));
  //no search term or empty search, return all brands
  if (!query) {
    response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
    response.end(JSON.stringify(brands));
  }

  //find brands that match search
  const matchedBrands = brands.filter(brand => {
    return (brand.name.toLowerCase() === query.toLowerCase()) ? true : false;
  });

  //send 200 if any brands found, 404 otherwise
  if (matchedBrands.length > 0) {
    response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify(matchedBrands));
  }
  //else
  response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
  return response.end(JSON.stringify({
    code: 404,
    message: 'Brand not found',
    fields: 'query'
  }));
});

myRouter.get('/brands/:categoryId/products', (request, response) => {
  const { categoryId } = request.params;  

  //reverse logic to have one return 404 instead of two
  //validate categoryId
  //only checking for existence
  if (categoryId) {
    //now check if categoryId exists in brands[]
    const category = brands.find(brand => brand.id === categoryId);
    if (category) {
      const productsInCategory = products.filter(product => {
        return (product.categoryId === categoryId) ? true : false;
      });
      
      response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
      return response.end(JSON.stringify(productsInCategory));
    }
  }

  //else either categoryId or category does not exist
  response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
  return response.end(JSON.stringify({
    code: 404,
    message: 'Brand not found',
    fields: 'id'
  }));
});

myRouter.get('/products', (request, response) => {
  //substring(8) returns query after the '?' if client sends any
  const { query } = queryString.parse(request.url.substring(10));
  //if no query or empty string, return all products
  if (!query) {
    response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify(products));
  }
  //else search for query
  const matchedProducts = products.filter(product => {
    return (product.name.toLowerCase().includes(query.toLowerCase()) || product.description.toLowerCase().includes(query.toLowerCase()))
      ? true
      : false;
  });
  //if matchedProducts empty return 404, else return
  if (matchedProducts.length > 0) {
    response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify(matchedProducts));
  }
  response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
  return response.end(JSON.stringify({
    code: 404,
    message: 'Product not found',
    fields: 'query'
  }));
});

//failedLoginAttempts logic works, although it keeps incrementing
//  failed logins when sent valid data and user has already passed max login attempts
myRouter.post('/login', (request, response) => {
  //Check for username, email and password in request body
  const { username, email, password } = request.body;
  if (username === undefined && email === undefined) {
    //missing parameters
    response.writeHead(400, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 400,
      message: 'Incorrectly formatted request',
      fields: 'POST body'
    }));
  }
  //not adding to failedLoginAttempts since username/email not in data
  // should this add to failedLoginAttempts anyway?
  const userForLoginAttempts = username || users.find(u => u.email === email);
  if (userForLoginAttempts === undefined) {
    const usernameOrEmailText = username ? 'username' : 'email';
    response.writeHead(401, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 401,
      message: `Invalid ${usernameOrEmailText} or password`,
      fields: 'POST body'
    }));
  }
  const usernameForLoginAttempts = (username) ? username :userForLoginAttempts.login.username;
  if (!failedLoginAttempts[usernameForLoginAttempts]) {
    failedLoginAttempts[usernameForLoginAttempts] = 0;
  }
  if ((username && password || email && password) && !(username && email)) {
    //see if there is a user that matches
    const user = users.find(user => {
      return user.login.username === username && user.login.password === password ||
             user.email === email && user.login.password === password;
    });
    //failedLoginAttempts validation here instead of in above if to return correct error code4z
    if (user && (failedLoginAttempts[usernameForLoginAttempts] < MAX_LOGIN_ATTEMPTS_ALLOWED)) {
      //since user found, reset failedLoginAttempts
      failedLoginAttempts[usernameForLoginAttempts] = 0;
      response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
      //successful login, check access tokens
      const currentAccessToken = accessTokens.find((obj) => {
        return obj.username === user.login.username;
      });
      //if token exists, update otherwise create new token
      if (currentAccessToken) {
        currentAccessToken.lastUpdated = new Date();
        return response.end(JSON.stringify({ accessToken: currentAccessToken.token }));
      } else {
        const newAccessToken = {
          username: user.login.username,
          lastUpdated: new Date(),
          token: uid(16)
        };
        accessTokens.push(newAccessToken);
        return response.end(JSON.stringify({ accessToken: newAccessToken.token }));
      }
    } else {
      //login failed
      //update failedLoginAttempts
      const numAttempts = failedLoginAttempts[usernameForLoginAttempts];
      if (numAttempts) {
        failedLoginAttempts[usernameForLoginAttempts]++;
      } else {
        failedLoginAttempts[usernameForLoginAttempts] = 1;
      }
      const usernameOrEmailText = username ? 'username' : 'email';
      response.writeHead(401, {...CORS_HEADERS, 'content-type': 'application/json'});
      return response.end(JSON.stringify({
        code: 401,
        message: `Invalid ${usernameOrEmailText} or password`,
        fields: 'POST body'
      }));
    }
  } else {
    //missing parameters
    response.writeHead(400, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 400,
      message: 'Incorrectly formatted request',
      fields: 'POST body'
    }));
  }
});

//private routes - access token required////////////////////////////////////////////////////
myRouter.get('/me/cart', (request, response) => {
  const currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    response.writeHead(403, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 403,
      message: 'Unauthorized - Missing or invalid accessToken, can only access cart if user is logged in',
      fields: 'query'
    }));
  } else {
    //find user and return their cart
    const user = users.find(user => {
      return user.login.username === currentAccessToken.username;
    });
    response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify(user.cart));
  }
});

myRouter.post('/me/cart', (request, response) => {
  //validate access token
  const currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    //either no token sent or invalid token
    response.writeHead(403, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 403,
      message: 'Unauthorized - Missing or invalid accessToken, can only access cart if user is logged in',
      fields: 'query'
    }));
  } else {
    //check if productId is valid
    const productId = require('url').parse(request.url, true).query.productId;
    if (productId) {
      //find product, add to cart and return copy
      const product = products.find(product => {
        return product.id === productId;
      });
      if (product) {
        //find user and add to cart
        const user = users.find(user => {
          return user.login.username === currentAccessToken.username;
        });
        //shouldn't need to check if user exists? since would be handled by getValidTokenFromRequest
        //check if product is already in cart - if client wants to change product they should use PUT
        if (user.cart.length > 0) {
          const existingProduct = user.cart.find(item => {
            return item.product.id === productId;
          });
          if (existingProduct) {
            response.writeHead(409, {...CORS_HEADERS, 'content-type': 'application/json'});
            return response.end(JSON.stringify({
              code: 409,
              message: 'Product already in user\'s cart',
              fields: 'POST'
            }));
          }
        }
        //add to cart
        user.cart.push({
          product: product,
          quantity: 1
        });
        //return copy
        response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
        return response.end(JSON.stringify(product));
      } else {
        response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
        return response.end(JSON.stringify({
          code: 404,
          message: 'Product not found',
          fields: 'query'
        }));
      }
    } else {
      response.writeHead(400, {...CORS_HEADERS, 'content-type': 'application/json'});
      return response.end(JSON.stringify({
        code: 400,
        message: 'Bad request - productId required',
        fields: 'query'
      }));
    }
  }
});

myRouter.put('/me/cart/:productId', (request, response) => {
  //validate access token
  const currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    //either no token sent or invalid token
    response.writeHead(403, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 403,
      message: 'Unauthorized - Missing or invalid accessToken, can only access cart if user is logged in',
      fields: 'query'
    }));
  } 
  //validate productId and quantity
  const { productId } = request.params; 
  //check if quantity is valid - can't combine with above since fields are different
  const quantity = require('url').parse(request.url, true).query.quantity;
  //since our products are id'd starting at 1
  if (!quantity || quantity === '0') {
    response.writeHead(400, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 400,
      message: 'Invalid quantity',
      fields: 'query'
    }));
  }
  //get logged in user
  const user = users.find(user => {
    return user.login.username === currentAccessToken.username;
  });
  //find product in cart
  const productToUpdate = user.cart.find(item => {
    return item.product.id === productId;
  });
  //update if found
  if (productToUpdate) {
    productToUpdate.quantity = quantity;
    response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify(productToUpdate));
  }
  //else 404
  response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
  return response.end(JSON.stringify({
    code: 404,
    message: 'Product not found',
    fields: 'path'
  }));
});

//this route has 404 repeated several times - see if the logic can be simplified to one 404
myRouter.delete('/me/cart/:productId', (request, response) => {
  //validate access token
  const currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    //either no token sent or invalid token
    response.writeHead(403, {...CORS_HEADERS, 'content-type': 'application/json'});
    return response.end(JSON.stringify({
      code: 403,
      message: 'Unauthorized - Missing or invalid accessToken, can only access cart if user is logged in',
      fields: 'query'
    }));
  } else {
    //check user's cart for product
    const { productId } = request.params;
    if (productId) {
      //find user from access token
      const user = users.find(user => user.login.username === currentAccessToken.username);
      //check cart size
      if (user.cart.length > 0) {
        //find product in cart
        const productToDelete = user.cart.find(item => item.product.id === productId);
        if (!productToDelete) {
          response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
          return response.end(JSON.stringify({
            code: 404,
            message: 'Product not found',
            fields: 'path'
          }));
        }
        //filter out of cart and return
        user.cart = user.cart.filter(item => item !== productToDelete);
        response.writeHead(200, {...CORS_HEADERS, 'content-type': 'application/json'});
        return response.end(JSON.stringify(productToDelete.product));
      } else {
        response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
        return response.end(JSON.stringify({
          code: 404,
          message: 'Product not found',
          fields: 'path'
        }));
      }
    //else 404 not found
    } else {
      response.writeHead(404, {...CORS_HEADERS, 'content-type': 'application/json'});
      return response.end(JSON.stringify({
        code: 404,
        message: 'Product not found',
        fields: 'path'
      }));
    }
  }
});


//helper method to check access tokens
const getValidTokenFromRequest = (request) => {
  const parsedUrl = require('url').parse(request.url, true);
  if (parsedUrl.query.accessToken) {
    //make sure token is not expired
    const currentAccessToken = accessTokens.find(accessToken => {
      return accessToken.token === parsedUrl.query.accessToken && ((new Date) - accessToken.lastUpdated) < TOKEN_VALIDITY_TIMEOUT;
    });
    if (currentAccessToken) {
      return currentAccessToken;
    } else {
      return null;
    }
  } else {
    return null;
  }
};

//export for testing
module.exports = server;