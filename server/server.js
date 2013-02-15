/**
 * @author Benjamin Berman
 */

Meteor.publish("openGames",function() {
	return Games.find({open:true},{fields:{password:0,questionCards:0,answerCards:0}});
});

Meteor.publish("myHands",function() {
	return Hands.find({userId:this.userId});
});

Meteor.publish("myGames",function(userId) {
    return Games.find({userIds:userId},{fields:{password:0,questionCards:0,answerCards:0}});
});

Meteor.publish("myOwnedGames",function() {
	return Games.find({ownerId:this.userId},{fields:{password:0,questionCards:0,answerCards:0}});
});

Meteor.publish("players",function(gameId) {
    return Players.find({gameId:gameId});
})

Meteor.publish("submissions", function(gameId,round) {
    var recordset = this;
    var game = Games.findOne({_id:gameId});
    var submissions = [];

    var updateSubmissions = function () {
        // get all the submissions for a particular game and round
        submissions = Submissions.find({gameId:gameId,round:round},{fields:{_id:1,gameId:1,answerId:1,round:1}}).fetch();
        connectedPlayersCount = Players.find({gameId:gameId,connected:true}).count();
        // if we have sufficient submissions, reveal them
        if (submissions.length >= connectedPlayersCount-1) {
            _.each(submissions,function(submission){
                recordset.set("submissions",submission._id, _.omit(submission,'_id'));
            });

        // otherwise, keep them hidden
        } else {
            _.each(submissions,function(submission){
                recordset.set("submissions",submission._id, _.omit(submission,['_id','answerId']));
            });
        }

        recordset.flush();
    };

    var submissionHandle = Submissions.find({gameId:gameId,round:round},{fields:{_id:1,gameId:1,answerId:1,round:1}}).observe({
        added: updateSubmissions,
        removed: updateSubmissions,
        changed: updateSubmissions
    });

    var gameHandle = Games.find({_id:gameId}).observe({
        changed: function(document,index,oldDocument) {
            game = document;
            updateSubmissions();
        }
    });

    recordset.complete();
    recordset.flush();

    recordset.onStop(function () {
        submissionHandle.stop();
        gameHandle.stop();
    });
});

Meteor.publish("votesInGame",function(gameId){
	return Votes.find({gameId:gameId});
});

Meteor.publish("cards",function() {
	return Cards.find({});
});

Meteor.publish("usersInGame",function(gameId) {
    // privacy concerns. but does not update correctly when gameId changes.
	return Meteor.users.find({},{fields:{_id:1,username:1,emails:1,profile:1,location:1}});
});

Meteor.startup(function () {
    // Add the heartbeat field to the user profile
    Accounts.onCreateUser(function(options, user) {
        if (options.profile)
            user.profile = options.profile;
        else
            user.profile = {};
        user.profile.heartbeat = new Date().getTime();
        return user;
    });

    // enable the geospatial index on games and users
    try {
        Games._ensureIndex({location:"2d"});
        Games._ensureIndex({players:1,modified:-1});
        Votes._ensureIndex({gameId:1});
        Hands._ensureIndex({gameId:1});
        Cards._ensureIndex({deckId:1});
        Decks._ensureIndex({title:1});
        Cards._ensureIndex({type:1});
        Players._ensureIndex({gameId:1,userId:1,connected:1});
        Submissions._ensureIndex({gameId:1});
        Meteor.users._ensureIndex({'profile.heartbeat':-1});
        Meteor.users._ensureIndex({'profile.location':"2d"});
    } catch (e) {
        console.log("Indexing failure. " + e);
    }

    try {
        if (Cards.find({}).count() < 1) {
            // Cards Against Humanity cards
            var CAHDeck = new Deck();
            CAHDeck.title = "Cards Against Humanity";
            CAHDeck.ownerId = "";
            CAHDeck.description = "The complete Cards Against Humanity questions and answers, licensed Creative Commons" +
                "2.0 BY-NC-SA.";
            CAHDeck.price = 0;

            var CAHId = Decks.insert(CAHDeck);

            _.forEach(CAH_QUESTION_CARDS,function(c){
                Cards.insert({text:c,type:CARD_TYPE_QUESTION,deckId:CAHId});
            });

            _.forEach(CAH_ANSWER_CARDS,function(c){
                Cards.insert({text:c,type:CARD_TYPE_ANSWER,deckId:CAHId});
            });
        }
    } catch (e) {
        console.log("Card creation failure.");
    }


    // make sure users have full schema
    try {
        Meteor.users.update({heartbeat:{$exists:false},location:{$exists:false}},{$set:{heartbeat:new Date().getTime(),location:null}},{multi:true});
    } catch (e) {
        console.log("User schema extension failure.");
    }


    // make sure games have full schema
    try {
        Games.update({connected:{$exists:false},modified:{$exists:false}},{$set:{connected:[],modified:new Date().getTime()}},{multi:true});
    } catch (e) {
        console.log("Game schema extension failure.");
    }

    // Close games that haven't seen any activity for a while
    Meteor.setInterval(function () {
        Games.update({open:true,modified:{$lt:new Date().getTime() - K_HEARTBEAT*20}},{$set:{open:false}},{multi:true});
    },40*K_HEARTBEAT);

    // Update player connected status
    Meteor.setInterval(function () {
        var disconnectedUsers = Meteor.users.find({'profile.heartbeat':{$lt:new Date().getTime() - K_HEARTBEAT}}).fetch();

        // Set the connected attribute of the Players collection documents to false for disconnected users
        Players.update({userId:{$in:_.pluck(disconnectedUsers,'_id')},connected:true},{$set:{connected:false}},{multi:true});

        // Update the judges
        _.each(Games.find({open:true}).fetch(),function(g){
            var gameCurrentJudge = Meteor.call("currentJudge",g._id);
            if (g.judge !== gameCurrentJudge) {
                Games.update({_id:g._id},{$set:{judgeId:gameCurrentJudge}});
            }
        });

    },2*K_HEARTBEAT);
});

Meteor.methods({
    // Draw hands for all players in the game.
    drawHands: function(gameId,handSize) {
        if (Meteor.isSimulation)
            return "";

        handSize = handSize || K_DEFAULT_HAND_SIZE;

        var game = Games.findOne({_id:gameId, open:true});

        if (!game)
            throw new Meteor.Error(404,"No game to draw hands from.");

        if (Players.find({gameId:gameId,userId:this.userId}).count() === 0)
            throw new Meteor.Error(403,"You are not in this game.");

        if (!_.has(game,"answerCards"))
            throw new Meteor.Error(500,"Why are there no answer cards?");

        // all answer cards exhausted, do not draw any more cards.
        if (game.answerCards.length < 1)
            throw new Meteor.Error(403,"The game is over.");

        if (!game.open)
        // the game is over. only score screen will display.
            throw new Meteor.Error(403,"This game is closed.");

        var users = _.pluck(Players.find({gameId:gameId}).fetch(),'userId');

        // storing all the ids of drawn cards to remove from the game database entry
        var drawnCards = [];

        // a card drawing function
        var drawCards = function(oldHand) {
            var newHand = oldHand || [];

            while (newHand.length < handSize) {
                if (game.answerCards.length > 0)
                    newHand.push(game.answerCards.pop());
            }

            // add the drawn cards to the list of cards to remove later from the game's deck
            drawnCards = _.union(drawnCards,newHand);

            return newHand;
        }

        // all the hands associated with this game and the game's current round.
        var returns = [];
        // a list of users who have full hands.
        var fulfilledUsers = [];

        // update any existing hands
        _.each(Hands.find({gameId:gameId,round:game.round}).fetch(),function (handDoc) {
            // fill out the hand
            if (handDoc.hand.length < handSize) {
                Hands.update({_id:handDoc._id,hand:drawCards(handDoc.hand)});
            }

            // add the hand to the hands associated with this game
            returns.push(handDoc._id);
            // add this user to the fulfilled users
            fulfilledUsers.push(handDoc.userId);
        });

        var newlyFulfilledUsers = [];

        // insert new hands
        _.each(_.difference(users,fulfilledUsers),function(userId) {
            var oldHand = [];

            if (game.round > 0) {
                // get the old hand
                var oldHandDoc = Hands.findOne({gameId:gameId,round:game.round-1,userId:userId});
                if (oldHandDoc)
                    oldHand = _.union(oldHand,oldHandDoc.hand);
            }

            // add the new hand
            returns.push(
                Hands.insert({gameId:gameId,round:game.round,userId:userId,hand:drawCards(oldHand)})
            );

            // this user is now fulfilled
            newlyFulfilledUsers.push(userId);
        });

        fulfilledUsers = _.union(fulfilledUsers,newlyFulfilledUsers);

        returns = _.compact(returns);

        if (!returns)
            throw new Meteor.Error(500,"No cards drawn.");


        // update the game
        Games.update({_id:gameId},{$pullAll:{answerCards:drawnCards},$set:{modified:new Date().getTime()}});

        // return calling user's hand for this round and game
        return Hands.findOne({gameId:gameId,round:game.round,userId:this.userId})._id;
    },

    // Join a game
    joinGame: function(gameId) {
        var g = Games.findOne({_id:gameId});

        if (!g)
            throw new Meteor.Error(404,"Cannot join nonexistent game.");

        if (!g.open)
            throw new Meteor.Error(403,"The game is closed, cannot join.");

        // If this user is already in the game, update the connected status and return.
        if (Players.find({gameId:gameId,userId:this.userId}).count() > 0) {
            Players.update({gameId:gameId,userId:this.userId},{$set:{connected:true}});
            return gameId;
        }

        // Otherwise, join the game by adding to the players list, updating the heartbeat, and incrementing the players
        // count.
        var p = new Player();

        p.userId = this.userId;
        p.gameId = gameId;
        p.voted = new Date().getTime();
        p.connected = true;

        Players.insert(p);

        Games.update({_id:gameId},{$inc: {players:1}, $addToSet:{userIds:this.userId}, $set:{modified:new Date().getTime()}});

        Meteor.users.update({_id:this.userId},{$set:{heartbeat:new Date().getTime()}});

        Meteor.call("drawHands",gameId,K_DEFAULT_HAND_SIZE);

        return gameId;
    },

    findGameWithFewPlayers: function() {
        // find the latest game with fewer than five players

        var game = Games.findOne({open:true, players:{$lt:K_PREFERRED_GAME_SIZE}});

        if (!game)
            return false;
        else
            return game._id;
    },

    findLocalGame: function(location) {
        if (this.isSimulation)
            return;

        location = location || null;

        if (!location)
            return false;

        var game = Games.findOne({open:true,location:{$within:{$center:[location,K_LOCAL_DISTANCE]}}});

        if (!game)
            return false;
        else
            return game._id;
    },

    findAnyGame: function() {
        var game = Games.findOne({open:true});

        if (!game)
            return false;
        else
            return game._id;
    },

    // Create a new, empty game
    // required title
    // optional password
    createEmptyGame: function(title,password,location) {
        console.log("Creating " + JSON.stringify([title,password,location]));
        password = password || "";
        location = location || null;

        if (title=="")
            title = "Game #" + (Games.find({}).count() + 1).toString();

//		if (Games.find({title:title,open:true}).count() > 0)
//			throw new Meteor.Error(500,"A open game by that name already exists!");

        var shuffledAnswerCards = _.shuffle(_.pluck(Cards.find({type:CARD_TYPE_ANSWER},{fields:{_id:1}}).fetch(),'_id'));

        if (!shuffledAnswerCards)
            throw new Meteor.Error(404,"No answer cards found.");

        var shuffledQuestionCards = _.shuffle(_.pluck(Cards.find({type:CARD_TYPE_QUESTION},{fields:{_id:1}}).fetch(),'_id'));

        if (!shuffledQuestionCards)
            throw new Meteor.Error(404,"No question cards found.");

        var firstQuestionCardId = shuffledQuestionCards.pop();

        return Games.insert({
            title:title, // game title
            password:password, // game password if any
            players:0, // number of players in the game
            round:0, // round number
            questionCards:shuffledQuestionCards,
            answerCards:shuffledAnswerCards,
            questionId:firstQuestionCardId,
            open:true,
            ownerId:this.userId,
            created: new Date().getTime(),
            modified: new Date().getTime(),
            judgeId:this.userId,
            userIds:[],
            location: location
        });
    }
});

var clearDatabase = function() {
    Games.remove({});
    Hands.remove({});
    Players.remove({});
    Votes.remove({});
    Cards.remove({});
    Submissions.remove({});
    Meteor.users.remove({});
};