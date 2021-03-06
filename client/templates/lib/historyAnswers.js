/**
 * @author Benjamin Berman
 * © 2014 All Rights Reserved
 **/
Template.historyAnswers.rendered = defaultRendered;
Template.historyAnswers.created = defaultCreated;

Template.historyAnswers.answers = function () {
    return Inventories.find({itemType: INVENTORY_ITEM_TYPE_CARD, quantity: {$gt: 0}});
};

Template.historyAnswers.isAnswerCard = function (cardId) {
    return Cards.find({_id: cardId, type: {$in: [CARD_TYPE_ANSWER, CARD_TYPE_NOUN]}}).count() !== 0;
}

Template.historyAnswers.events = {
    'click a': function (e) {
        Router.go('home');
        var answerCardId = $(e.currentTarget).attr('id');
        var history = Session.get("history");
        Meteor.call("writeAnswer", history._id, answerCardId);
    }
};
